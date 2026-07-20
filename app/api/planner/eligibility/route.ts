import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import { courseRecords, userPrograms } from "@/db/schema";
import {
  AcademicDataError,
  getCatalogMetadata,
  getCourseRequirementDocuments,
} from "@/lib/academic";
import { getLocalSession } from "@/lib/auth";
import {
  academicTermSequence,
  isEarlierAcademicTerm,
  isNonAcademicCourseCode,
} from "@/lib/course-records";
import {
  normalizeCourseCode,
  validateCourseEligibility,
} from "@/lib/requirements";
import {
  hydrateStudentPrograms,
  studentProgramEvidence,
} from "@/lib/student-program-evidence";
import type {
  AcademicEnvironment,
  CourseEligibilityResult,
  StudentCourseRecord,
} from "@/lib/types";

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function gradePercent(grade: string | null): number | null {
  if (!grade) return null;
  const parsed = Number(grade);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function toEvaluationCourse(
  record: typeof courseRecords.$inferSelect,
): StudentCourseRecord {
  return {
    coursePid: record.coursePid,
    courseCode: record.courseCode,
    status: record.status === "transfer" ? "completed" : record.status,
    gradePercent: gradePercent(record.grade),
    credits: record.credits,
    term: record.term,
  };
}

function availableAcademicUnits(
  records: Array<typeof courseRecords.$inferSelect>,
): number | null {
  const accepted = records.filter(
    (record) =>
      ["completed", "transfer", "planned"].includes(record.status) &&
      !isNonAcademicCourseCode(record.courseCode),
  );
  const uniqueCourses = new Map<string, typeof courseRecords.$inferSelect>();
  for (const record of accepted) {
    const key = record.coursePid || normalizeCourseCode(record.courseCode);
    const current = uniqueCourses.get(key);
    if (!current || (current.credits == null && record.credits != null)) {
      uniqueCourses.set(key, record);
    }
  }
  const courses = [...uniqueCourses.values()];
  if (courses.some((course) => course.credits == null)) return null;
  return courses.reduce((sum, course) => sum + (course.credits ?? 0), 0);
}

function matchedCourseCodes(result: CourseEligibilityResult): Set<string> {
  return new Set(
    result.documents.flatMap((document) =>
      (document.root?.matchedCourseCodes ?? []).map(normalizeCourseCode),
    ),
  );
}

function reliesOnPlannedCourses(
  result: CourseEligibilityResult,
  earlierRecords: Array<typeof courseRecords.$inferSelect>,
): boolean {
  const matchedCodes = matchedCourseCodes(result);
  return [...matchedCodes].some((courseCode) => {
    const matching = earlierRecords.filter(
      (record) => normalizeCourseCode(record.courseCode) === courseCode,
    );
    return (
      matching.some((record) => record.status === "planned") &&
      !matching.some(
        (record) => record.status === "completed" || record.status === "transfer",
      )
    );
  });
}

export async function GET(request: Request) {
  try {
    const session = await getLocalSession(request);
    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in with ROwO to continue.", 401);
    }

    const academicEnv = env as unknown as AcademicEnvironment;
    const db = getUserDb();
    const [records, programs, metadata] = await Promise.all([
      db
        .select()
        .from(courseRecords)
        .where(eq(courseRecords.userId, session.user.localId)),
      db
        .select()
        .from(userPrograms)
        .where(eq(userPrograms.userId, session.user.localId)),
      getCatalogMetadata(academicEnv),
    ]);
    const plannedCourses = records.filter((record) => record.status === "planned");
    const requirementEntries = await Promise.all(
      [...new Set(plannedCourses.map((record) => record.coursePid))].map(
        async (coursePid) => [
          coursePid,
          await getCourseRequirementDocuments(academicEnv, coursePid),
        ] as const,
      ),
    );
    const requirementsByCourse = new Map(requirementEntries);
    const hydratedPrograms = await hydrateStudentPrograms(
      academicEnv,
      programs,
      metadata.catalogId,
    );
    const programEvidence = studentProgramEvidence(hydratedPrograms);

    const results = plannedCourses.map((course) => {
      if (course.catalogId !== metadata.catalogId) {
        return {
          courseId: course.id,
          courseCode: course.courseCode,
          term: course.term,
          state: "UNKNOWN" as const,
          eligible: false,
          needsReview: true,
          reliesOnPlanned: false,
          unmetCourseCodes: [],
          unknownReasons: [
            "This course belongs to a different academic calendar.",
          ],
        };
      }
      if (academicTermSequence(course.term) === null) {
        return {
          courseId: course.id,
          courseCode: course.courseCode,
          term: course.term,
          state: "UNKNOWN" as const,
          eligible: false,
          needsReview: true,
          reliesOnPlanned: false,
          unmetCourseCodes: [],
          unknownReasons: ["The planned course does not have a valid academic term."],
        };
      }

      const earlierRecords = records.filter(
        (record) =>
          record.id !== course.id &&
          isEarlierAcademicTerm(record.term, course.term),
      );
      const eligibility = validateCourseEligibility(
        requirementsByCourse.get(course.coursePid) ?? [],
        {
          courses: earlierRecords.map(toEvaluationCourse),
          programs: programEvidence,
          totalUnits: availableAcademicUnits(earlierRecords),
        },
        { includePlanned: true },
      );
      return {
        courseId: course.id,
        courseCode: course.courseCode,
        term: course.term,
        state: eligibility.state,
        eligible: eligibility.eligible,
        needsReview: eligibility.needsReview,
        reliesOnPlanned: reliesOnPlannedCourses(eligibility, earlierRecords),
        unmetCourseCodes: eligibility.unmetCourseCodes,
        unknownReasons: eligibility.unknownReasons,
      };
    });

    return Response.json(
      { success: true, results },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AcademicDataError) {
      return errorResponse(
        "ACADEMIC_CATALOG_UNAVAILABLE",
        "The academic calendar is temporarily unavailable.",
        503,
      );
    }
    return errorResponse(
      "INTERNAL_ERROR",
      "Unable to check planner eligibility.",
      500,
    );
  }
}
