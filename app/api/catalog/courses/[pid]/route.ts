import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import { courseRecords, userPrograms } from "@/db/schema";
import {
  AcademicDataError,
  getCatalogMetadata,
  getCourseByPid,
  getCourseRequirementDocuments,
} from "@/lib/academic";
import { getLocalSession } from "@/lib/auth";
import { summarizePublicRequirement } from "@/lib/public-academic";
import { validateCourseEligibility } from "@/lib/requirements";
import {
  hydrateStudentPrograms,
  studentProgramEvidence,
} from "@/lib/student-program-evidence";
import type { AcademicEnvironment, StudentCourseRecord } from "@/lib/types";

type RouteContext = { params: Promise<{ pid: string }> | { pid: string } };

class InputError extends Error {}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function routePid(context: RouteContext): Promise<string> {
  const { pid } = await context.params;
  const normalized = pid.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new InputError("The course identifier is invalid.");
  }
  return normalized;
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

export async function GET(request: Request, context: RouteContext) {
  try {
    const pid = await routePid(context);
    const academicEnv = env as unknown as AcademicEnvironment;
    const [course, requirements, catalog, session] = await Promise.all([
      getCourseByPid(academicEnv, pid),
      getCourseRequirementDocuments(academicEnv, pid),
      getCatalogMetadata(academicEnv),
      getLocalSession(request),
    ]);
    if (!course) {
      return errorResponse("COURSE_NOT_FOUND", "Course not found.", 404);
    }
    const { notesHtml: _notesHtml, ...publicCourse } = course;
    void _notesHtml;

    let eligibility = null;
    let recordedCount = 0;
    if (session) {
      const db = getUserDb();
      const [records, programs] = await Promise.all([
        db
          .select()
          .from(courseRecords)
          .where(eq(courseRecords.userId, session.user.localId)),
        db
          .select()
          .from(userPrograms)
          .where(eq(userPrograms.userId, session.user.localId)),
      ]);
      recordedCount = records.filter(
        (record) => record.coursePid === course.pid || record.courseCode === course.code,
      ).length;
      const hydratedPrograms = await hydrateStudentPrograms(
        academicEnv,
        programs,
        course.catalogId,
      );
      eligibility = validateCourseEligibility(requirements, {
        courses: records.map(toEvaluationCourse),
        programs: studentProgramEvidence(hydratedPrograms),
      });
    }

    return Response.json(
      {
        success: true,
        catalog,
        course: publicCourse,
        requirements: requirements.map(summarizePublicRequirement),
        eligibility,
        viewer: {
          signedIn: Boolean(session),
          recordedCount,
        },
      },
      {
        headers: {
          "cache-control": session
            ? "private, no-store"
            : "public, max-age=300, s-maxage=900",
        },
      },
    );
  } catch (error) {
    if (error instanceof InputError) {
      return errorResponse("INVALID_COURSE", error.message, 400);
    }
    if (error instanceof AcademicDataError) {
      return errorResponse(
        "ACADEMIC_CATALOG_UNAVAILABLE",
        "The academic calendar is temporarily unavailable.",
        503,
      );
    }
    return errorResponse("INTERNAL_ERROR", "Unable to load the course.", 500);
  }
}
