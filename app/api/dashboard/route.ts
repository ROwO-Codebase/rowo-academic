import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import { courseRecords, userPrograms } from "@/db/schema";
import {
  AcademicDataError,
  getCatalogMetadata,
  getCourseByCode,
  getProgramByPid,
  getProgramRequirementDocuments,
} from "@/lib/academic";
import { getLocalSession } from "@/lib/auth";
import {
  countedAcademicUnits,
  isNonAcademicCourseCode,
} from "@/lib/course-records";
import {
  collectUnmetCourseCodes,
  evaluateRequirementDocuments,
  extractCourseRecommendations,
} from "@/lib/requirements";
import type {
  AcademicEnvironment,
  RequirementEvaluationContext,
  StudentCourseRecord,
} from "@/lib/types";

const MAX_RECOMMENDATIONS = 12;

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function publicCourse(record: typeof courseRecords.$inferSelect) {
  const { userId: _userId, ...course } = record;
  void _userId;
  return course;
}

function publicProgram(record: typeof userPrograms.$inferSelect | null) {
  if (!record) return null;
  const { userId: _userId, ...program } = record;
  void _userId;
  return program;
}

function gradePercent(grade: string | null): number | null {
  if (!grade) return null;
  const parsed = Number(grade);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function toEvaluationCourse(record: typeof courseRecords.$inferSelect): StudentCourseRecord {
  return {
    coursePid: record.coursePid,
    courseCode: record.courseCode,
    status: record.status === "transfer" ? "completed" : record.status,
    gradePercent: gradePercent(record.grade),
    credits: record.credits,
    term: record.term,
  };
}

function completedUnits(records: Array<typeof courseRecords.$inferSelect>): number | null {
  const completed = records.filter(
    (record) =>
      (record.status === "completed" || record.status === "transfer") &&
      !isNonAcademicCourseCode(record.courseCode),
  );
  const uniqueCourses = new Map<
    string,
    typeof courseRecords.$inferSelect
  >();
  for (const record of completed) {
    const key = record.coursePid || record.courseCode;
    const current = uniqueCourses.get(key);
    if (!current || (current.credits == null && record.credits != null)) {
      uniqueCourses.set(key, record);
    }
  }
  const deduplicated = [...uniqueCourses.values()];
  if (deduplicated.some((record) => record.credits == null)) return null;
  return deduplicated.reduce((sum, record) => sum + (record.credits ?? 0), 0);
}

function termSortKey(term: string | null): number {
  if (!term) return -1;
  const match = term.match(/^(\d{4})-(Winter|Spring|Fall)$/);
  if (!match) return 0;
  const seasonRank = { Winter: 1, Spring: 2, Fall: 3 }[match[2] as "Winter" | "Spring" | "Fall"];
  return Number(match[1]) * 10 + seasonRank;
}

function groupByTerm(records: Array<typeof courseRecords.$inferSelect>) {
  const groups = new Map<string | null, Array<typeof courseRecords.$inferSelect>>();
  for (const record of records) {
    const list = groups.get(record.term) ?? [];
    list.push(record);
    groups.set(record.term, list);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => termSortKey(right) - termSortKey(left))
    .map(([term, courses]) => ({
      term,
      label: term ?? "Unscheduled",
      courses: courses.map(publicCourse),
      credits: courses.reduce(
        (sum, course) =>
          sum + countedAcademicUnits(course.courseCode, course.credits),
        0,
      ),
      completedCredits: courses
        .filter((course) => course.status === "completed" || course.status === "transfer")
        .reduce(
          (sum, course) =>
            sum + countedAcademicUnits(course.courseCode, course.credits),
          0,
        ),
    }));
}

export async function GET(request: Request) {
  try {
    const session = await getLocalSession(request);
    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in with ROwO to continue.", 401);
    }

    const db = getUserDb();
    const [programRows, records] = await Promise.all([
      db
        .select()
        .from(userPrograms)
        .where(eq(userPrograms.userId, session.user.localId))
        .orderBy(desc(userPrograms.isPrimary), desc(userPrograms.updatedAt)),
      db
        .select()
        .from(courseRecords)
        .where(eq(courseRecords.userId, session.user.localId))
        .orderBy(desc(courseRecords.updatedAt)),
    ]);
    const selectedProgram =
      programRows.find((program) => program.isPrimary) ?? programRows[0] ?? null;
    const academicEnv = env as unknown as AcademicEnvironment;
    const calendar = await getCatalogMetadata(academicEnv);
    const evaluationCourses = records.map(toEvaluationCourse);
    const evaluationPrograms = programRows
      .filter((program) => program.catalogId === calendar.catalogId)
      .map((program) => ({
        programPid: program.programPid,
        programCode: program.programCode,
        programTitle: program.programName,
        programType: program.programType,
        status: "active" as const,
      }));
    const sharedCompletedUnits = completedUnits(records);
    const programProgress = await Promise.all(
      programRows.map(async (savedProgram) => {
        const calendarMismatch = savedProgram.catalogId !== calendar.catalogId;
        if (calendarMismatch) {
          return {
            saved: publicProgram(savedProgram),
            catalog: null,
            calendarMismatch: true,
            requirementAnalysis: null,
            recommendations: [],
          };
        }

        const [program, documents] = await Promise.all([
          getProgramByPid(academicEnv, savedProgram.programPid),
          getProgramRequirementDocuments(academicEnv, savedProgram.programPid),
        ]);
        const context: RequirementEvaluationContext = {
          courses: evaluationCourses,
          programs: evaluationPrograms,
          completedUnits: sharedCompletedUnits,
        };
        const requirementAnalysis = evaluateRequirementDocuments(documents, context);
        const unmetCodes = new Set(collectUnmetCourseCodes(requirementAnalysis));
        const documentStates = new Map(
          requirementAnalysis.documents.map((document) => [
            document.documentId,
            document.state,
          ]),
        );
        const recommendations = extractCourseRecommendations(documents, context)
          .filter(
            (reference) =>
              unmetCodes.has(reference.courseCode) &&
              documentStates.get(reference.documentId) !== "MET",
          )
          .slice(0, MAX_RECOMMENDATIONS);

        return {
          saved: publicProgram(savedProgram),
          catalog: program,
          calendarMismatch: false,
          requirementAnalysis,
          recommendations,
        };
      }),
    );

    const recommendationMap = new Map<
      string,
      {
        courseCode: string;
        reason: string;
        isOption: boolean;
        programs: Array<{
          programId: string;
          programCode: string;
          programName: string;
          reason: string;
        }>;
      }
    >();
    for (const progress of programProgress) {
      if (!progress.saved) continue;
      for (const reference of progress.recommendations) {
        const current = recommendationMap.get(reference.courseCode) ?? {
          courseCode: reference.courseCode,
          reason: reference.reason,
          isOption: reference.isOption,
          programs: [],
        };
        if (
          !current.programs.some(
            (program) => program.programId === progress.saved?.id,
          )
        ) {
          current.programs.push({
            programId: progress.saved.id,
            programCode: progress.saved.programCode,
            programName: progress.saved.programName,
            reason: reference.reason,
          });
        }
        current.isOption = current.isOption && reference.isOption;
        recommendationMap.set(reference.courseCode, current);
      }
    }

    const rankedRecommendations = [...recommendationMap.values()]
      .sort(
        (left, right) =>
          right.programs.length - left.programs.length ||
          left.courseCode.localeCompare(right.courseCode),
      )
      .slice(0, MAX_RECOMMENDATIONS);
    const recommendations = await Promise.all(
      rankedRecommendations.map(async (recommendation) => ({
        ...recommendation,
        planCount: recommendation.programs.length,
        course: await getCourseByCode(academicEnv, recommendation.courseCode),
      })),
    );

    const selectedProgress = selectedProgram
      ? programProgress.find((progress) => progress.saved?.id === selectedProgram.id) ?? null
      : null;
    const calendarMismatch = selectedProgress?.calendarMismatch === true;
    const catalogProgram = selectedProgress?.catalog ?? null;
    const requirementAnalysis = selectedProgress?.requirementAnalysis ?? null;

    const statusCounts = Object.fromEntries(
      ["completed", "in_progress", "planned", "transfer"].map((status) => [
        status,
        records.filter((course) => course.status === status).length,
      ]),
    );

    return Response.json(
      {
        success: true,
        user: {
          id: session.user.id,
          username: session.user.username,
          wechatId: session.user.wechatId,
          role: session.user.role,
        },
        program: {
          selected: publicProgram(selectedProgram),
          catalog: catalogProgram,
          calendarMismatch,
        },
        programs: programProgress.map(({ recommendations: _recommendations, ...progress }) => {
          void _recommendations;
          return progress;
        }),
        courseRecords: records.map(publicCourse),
        calendar,
        requirementAnalysis,
        recommendedUnmetCourseReferences: recommendations,
        terms: groupByTerm(records),
        progress: {
          statusCounts,
          completedUnits: completedUnits(records),
          totalRecordedCredits: records.reduce(
            (sum, course) =>
              sum + countedAcademicUnits(course.courseCode, course.credits),
            0,
          ),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AcademicDataError) {
      return errorResponse(
        "ACADEMIC_CATALOG_UNAVAILABLE",
        "The academic calendar is temporarily unavailable.",
        503,
      );
    }
    return errorResponse("INTERNAL_ERROR", "Unable to load the dashboard.", 500);
  }
}
