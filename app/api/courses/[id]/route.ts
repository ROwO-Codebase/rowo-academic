import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import {
  COURSE_RECORD_STATUSES,
  courseRecords,
  userPrograms,
  type CourseRecordStatus,
} from "@/db/schema";
import {
  AcademicDataError,
  getCatalogMetadata,
  getCourseByPid,
  getCourseRequirementDocuments,
} from "@/lib/academic";
import { getLocalSession, isSameOriginMutation } from "@/lib/auth";
import { JsonBodyError, readBoundedJsonObject } from "@/lib/http";
import { validateCourseEligibility } from "@/lib/requirements";
import type {
  AcademicCourse,
  AcademicEnvironment,
  StudentCourseRecord,
} from "@/lib/types";

const MAX_BODY_BYTES = 12_288;
const MAX_GRADE_LENGTH = 16;
const BODY_KEYS = new Set(["status", "term", "grade", "credits"]);
const COURSE_RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

class InputError extends Error {}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await readBoundedJsonObject(request, MAX_BODY_BYTES);
    for (const key of Object.keys(value)) {
      if (!BODY_KEYS.has(key)) {
        throw new InputError(`Unsupported request field: ${key}.`);
      }
    }
    return value;
  } catch (error) {
    if (error instanceof JsonBodyError) throw new InputError(error.message);
    throw error;
  }
}

function parseStatus(value: unknown): CourseRecordStatus {
  if (
    typeof value !== "string" ||
    !COURSE_RECORD_STATUSES.includes(value as CourseRecordStatus)
  ) {
    throw new InputError(
      `status must be one of: ${COURSE_RECORD_STATUSES.join(", ")}.`,
    );
  }
  return value as CourseRecordStatus;
}

function parseTerm(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 32) {
    throw new InputError("term must be a short academic term such as 2026-Fall.");
  }
  const cleaned = value.trim().replace(/\s+/g, " ");
  const seasonFirst = cleaned.match(/^(Winter|Spring|Fall)[ -](\d{4})$/i);
  const yearFirst = cleaned.match(/^(\d{4})[ -](Winter|Spring|Fall)$/i);
  const year = seasonFirst?.[2] ?? yearFirst?.[1];
  const season = seasonFirst?.[1] ?? yearFirst?.[2];
  if (!year || !season || Number(year) < 2000 || Number(year) > 9999) {
    throw new InputError("term must use YYYY-Fall, YYYY-Winter, or YYYY-Spring.");
  }
  return `${year}-${season[0].toUpperCase()}${season.slice(1).toLowerCase()}`;
}

function termSortKey(term: string): number | null {
  const match = term.match(/^(\d{4})-(Winter|Spring|Fall)$/);
  if (!match) return null;
  const season = { Winter: 1, Spring: 2, Fall: 3 }[
    match[2] as "Winter" | "Spring" | "Fall"
  ];
  return Number(match[1]) * 10 + season;
}

function recordsAvailableByTerm(
  records: Array<typeof courseRecords.$inferSelect>,
  targetTerm: string,
) {
  const target = termSortKey(targetTerm);
  if (target == null) return records;
  return records.filter((record) => {
    if (!record.term) return true;
    const recorded = termSortKey(record.term);
    return recorded == null || recorded <= target;
  });
}

function parseGrade(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new InputError("A numeric grade must be between 0 and 100.");
    }
    return String(Math.round(value * 100) / 100);
  }
  if (typeof value !== "string") {
    throw new InputError("grade must be a percentage or a short grade code.");
  }
  const grade = value.trim().toUpperCase();
  if (!grade || grade.length > MAX_GRADE_LENGTH) {
    throw new InputError("grade must be a percentage or a short grade code.");
  }
  const numeric = Number(grade);
  if (Number.isFinite(numeric)) {
    if (numeric < 0 || numeric > 100) {
      throw new InputError("A numeric grade must be between 0 and 100.");
    }
    return String(Math.round(numeric * 100) / 100);
  }
  if (!/^[A-Z][A-Z0-9+-]{0,15}$/.test(grade)) {
    throw new InputError("grade contains unsupported characters.");
  }
  return grade;
}

function parseCredits(value: unknown, course: AcademicCourse): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InputError("credits must be a finite number.");
  }
  const credits = Math.round(value * 100) / 100;
  if (credits < 0 || credits > 5 || Math.abs(value - credits) > 1e-9) {
    throw new InputError("credits must be between 0 and 5 with at most two decimals.");
  }
  if (course.creditMin != null && credits < course.creditMin) {
    throw new InputError(`credits cannot be below the catalog minimum of ${course.creditMin}.`);
  }
  if (course.creditMax != null && credits > course.creditMax) {
    throw new InputError(`credits cannot exceed the catalog maximum of ${course.creditMax}.`);
  }
  return credits;
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

function publicCourse(record: typeof courseRecords.$inferSelect | undefined) {
  if (!record) return null;
  const { userId: _userId, ...course } = record;
  void _userId;
  return course;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && /unique constraint|course_records_user_course_term/i.test(
    `${error.message}\n${error.cause instanceof Error ? error.cause.message : ""}`,
  );
}

async function routeId(context: RouteContext): Promise<string> {
  const params = await context.params;
  const id = params.id;
  if (!COURSE_RECORD_ID.test(id)) throw new InputError("The course record id is invalid.");
  return id;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    if (!isSameOriginMutation(request)) {
      return errorResponse(
        "ORIGIN_MISMATCH",
        "This change must originate from ROwO Academic.",
        403,
      );
    }
    const session = await getLocalSession(request);
    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in with ROwO to continue.", 401);
    }
    const id = await routeId(context);
    const db = getUserDb();
    const [existing] = await db
      .select()
      .from(courseRecords)
      .where(
        and(
          eq(courseRecords.id, id),
          eq(courseRecords.userId, session.user.localId),
        ),
      )
      .limit(1);
    if (!existing) {
      return errorResponse("COURSE_RECORD_NOT_FOUND", "Course record not found.", 404);
    }

    const body = await readBody(request);
    const recognized = ["status", "term", "grade", "credits"].filter((key) =>
      Object.hasOwn(body, key));
    if (recognized.length === 0) {
      throw new InputError("At least one editable course field is required.");
    }

    const status = Object.hasOwn(body, "status")
      ? parseStatus(body.status)
      : existing.status;
    const term = Object.hasOwn(body, "term") ? parseTerm(body.term) : existing.term;
    const grade = Object.hasOwn(body, "grade") ? parseGrade(body.grade) : existing.grade;
    if ((status === "planned" || status === "in_progress") && !term) {
      throw new InputError("A term is required for planned and in-progress courses.");
    }
    if ((status === "planned" || status === "in_progress") && grade != null) {
      throw new InputError("A grade can only be recorded for completed or transfer courses.");
    }

    const academicEnv = env as unknown as AcademicEnvironment;
    const metadata = await getCatalogMetadata(academicEnv);
    if (existing.catalogId !== metadata.catalogId) {
      return errorResponse(
        "CALENDAR_MISMATCH",
        "This record belongs to a different academic calendar. Reconfirm your calendar before editing it.",
        409,
      );
    }
    const catalogCourse = await getCourseByPid(academicEnv, existing.coursePid);
    if (!catalogCourse) {
      return errorResponse(
        "COURSE_NOT_FOUND",
        "This course is no longer available in the active academic calendar.",
        409,
      );
    }
    const credits = Object.hasOwn(body, "credits")
      ? parseCredits(body.credits, catalogCourse)
      : existing.credits;

    const [otherCourses, programs] = await Promise.all([
      db
        .select()
        .from(courseRecords)
        .where(eq(courseRecords.userId, session.user.localId)),
      db
        .select()
        .from(userPrograms)
        .where(eq(userPrograms.userId, session.user.localId)),
    ]);
    if (
      otherCourses.some(
        (record) =>
          record.id !== existing.id &&
          record.courseCode === existing.courseCode &&
          record.term === term,
      )
    ) {
      return errorResponse(
        "COURSE_ALREADY_RECORDED",
        "This course is already recorded for that term.",
        409,
      );
    }

    let eligibility = null;
    if (status === "planned") {
      const documents = await getCourseRequirementDocuments(
        academicEnv,
        catalogCourse.pid,
      );
      eligibility = validateCourseEligibility(documents, {
        courses: recordsAvailableByTerm(
          otherCourses.filter((record) => record.id !== existing.id),
          term as string,
        )
          .map(toEvaluationCourse),
        programs: programs
          .filter((program) => program.catalogId === metadata.catalogId)
          .map((program) => ({
            programPid: program.programPid,
            programCode: program.programCode,
            programTitle: program.programName,
            programType: program.programType,
            status: "active" as const,
          })),
      });
    }

    const [course] = await db
      .update(courseRecords)
      .set({
        status,
        term,
        grade,
        credits,
        courseTitle: catalogCourse.title,
        courseVersionId: catalogCourse.versionId,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(courseRecords.id, existing.id),
          eq(courseRecords.userId, session.user.localId),
        ),
      )
      .returning();

    return Response.json(
      { success: true, course: publicCourse(course), catalogCourse, eligibility },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InputError) {
      return errorResponse("INVALID_INPUT", error.message, 400);
    }
    if (isUniqueConflict(error)) {
      return errorResponse(
        "COURSE_ALREADY_RECORDED",
        "This course is already recorded for that term.",
        409,
      );
    }
    if (error instanceof AcademicDataError) {
      return errorResponse(
        "ACADEMIC_CATALOG_UNAVAILABLE",
        "The academic calendar is temporarily unavailable.",
        503,
      );
    }
    return errorResponse("INTERNAL_ERROR", "Unable to update the course.", 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!isSameOriginMutation(request)) {
      return errorResponse(
        "ORIGIN_MISMATCH",
        "This change must originate from ROwO Academic.",
        403,
      );
    }
    const session = await getLocalSession(request);
    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in with ROwO to continue.", 401);
    }
    const id = await routeId(context);
    const deleted = await getUserDb()
      .delete(courseRecords)
      .where(
        and(
          eq(courseRecords.id, id),
          eq(courseRecords.userId, session.user.localId),
        ),
      )
      .returning({ id: courseRecords.id });
    if (deleted.length === 0) {
      return errorResponse("COURSE_RECORD_NOT_FOUND", "Course record not found.", 404);
    }
    return Response.json(
      { success: true, deleted: { id } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InputError) {
      return errorResponse("INVALID_INPUT", error.message, 400);
    }
    return errorResponse("INTERNAL_ERROR", "Unable to delete the course.", 500);
  }
}
