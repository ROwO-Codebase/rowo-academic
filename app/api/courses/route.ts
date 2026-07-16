import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
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
  getCourseByCode,
  getCourseRequirementDocuments,
} from "@/lib/academic";
import { getLocalSession, isSameOriginMutation } from "@/lib/auth";
import { JsonBodyError, readBoundedJsonObject } from "@/lib/http";
import {
  normalizeCourseCode,
  validateCourseEligibility,
} from "@/lib/requirements";
import type {
  AcademicCourse,
  AcademicEnvironment,
  CatalogMetadata,
  StudentCourseRecord,
} from "@/lib/types";

const MAX_BODY_BYTES = 12_288;
const MAX_COURSE_CODE_LENGTH = 32;
const MAX_GRADE_LENGTH = 16;
const BODY_KEYS = new Set(["courseCode", "status", "term", "grade", "credits"]);

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
  const fallback = course.credits ?? course.creditMin ?? null;
  if (value == null || value === "") return fallback;
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

function yearFromMetadata(metadata: CatalogMetadata): number {
  const match = metadata.calendarLabel.match(/\b(?:19|20)\d{2}\b/);
  if (!match) throw new AcademicDataError("The academic calendar year is invalid.");
  return Number(match[0]);
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
  return error instanceof Error && /unique constraint|course_records_user_course_term_uq/i.test(
    `${error.message}\n${error.cause instanceof Error ? error.cause.message : ""}`,
  );
}

export async function GET(request: Request) {
  try {
    const session = await getLocalSession(request);
    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in with ROwO to continue.", 401);
    }
    const courses = await getUserDb()
      .select()
      .from(courseRecords)
      .where(eq(courseRecords.userId, session.user.localId))
      .orderBy(desc(courseRecords.updatedAt), desc(courseRecords.createdAt));
    return Response.json(
      { success: true, courses: courses.map(publicCourse) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse("INTERNAL_ERROR", "Unable to load your courses.", 500);
  }
}

export async function POST(request: Request) {
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

    const body = await readBody(request);
    const rawCode = typeof body.courseCode === "string" ? body.courseCode.trim() : "";
    if (!rawCode || rawCode.length > MAX_COURSE_CODE_LENGTH) {
      throw new InputError("courseCode is required and is too long.");
    }
    const courseCode = normalizeCourseCode(rawCode);
    if (!courseCode) throw new InputError("courseCode is invalid.");

    const status = parseStatus(body.status);
    const term = parseTerm(body.term);
    const grade = parseGrade(body.grade);
    if ((status === "planned" || status === "in_progress") && !term) {
      throw new InputError("A term is required for planned and in-progress courses.");
    }
    if ((status === "planned" || status === "in_progress") && grade != null) {
      throw new InputError("A grade can only be recorded for completed or transfer courses.");
    }

    const academicEnv = env as unknown as AcademicEnvironment;
    const [catalogCourse, metadata] = await Promise.all([
      getCourseByCode(academicEnv, courseCode),
      getCatalogMetadata(academicEnv),
    ]);
    if (!catalogCourse) {
      return errorResponse(
        "COURSE_NOT_FOUND",
        "That course is not available in the active academic calendar.",
        404,
      );
    }
    const credits = parseCredits(body.credits, catalogCourse);

    const db = getUserDb();
    const [existing, programs] = await Promise.all([
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
      existing.some(
        (record) =>
          record.courseCode === catalogCourse.code && record.term === term,
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
        courses: recordsAvailableByTerm(existing, term as string).map(
          toEvaluationCourse,
        ),
        programs: programs
          .filter((program) => program.catalogId === metadata.catalogId)
          .map((program) => ({
            programPid: program.programPid,
            programCode: program.programCode,
            status: "active" as const,
          })),
      });
    }

    const now = Date.now();
    const [course] = await db
      .insert(courseRecords)
      .values({
        id: crypto.randomUUID(),
        userId: session.user.localId,
        catalogId: metadata.catalogId,
        coursePid: catalogCourse.pid,
        courseVersionId: catalogCourse.versionId,
        courseCode: catalogCourse.code,
        courseTitle: catalogCourse.title,
        status,
        term,
        grade,
        credits,
        calendarYear: yearFromMetadata(metadata),
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return Response.json(
      { success: true, course: publicCourse(course), catalogCourse, eligibility },
      { status: 201, headers: { "cache-control": "no-store" } },
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
    return errorResponse("INTERNAL_ERROR", "Unable to save the course.", 500);
  }
}
