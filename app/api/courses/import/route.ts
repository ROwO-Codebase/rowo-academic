import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import {
  COURSE_RECORD_STATUSES,
  courseRecords,
  type CourseRecordStatus,
} from "@/db/schema";
import {
  AcademicDataError,
  getCatalogMetadata,
  getCourseByCode,
} from "@/lib/academic";
import { getLocalSession, isSameOriginMutation } from "@/lib/auth";
import { JsonBodyError, readBoundedJsonObject } from "@/lib/http";
import { normalizeCourseCode } from "@/lib/requirements";
import type { AcademicCourse, AcademicEnvironment, CatalogMetadata } from "@/lib/types";

const MAX_BODY_BYTES = 65_536;
const MAX_IMPORT_COURSES = 50;
const MAX_COURSE_CODE_LENGTH = 32;
const BODY_KEYS = new Set(["courses"]);
const COURSE_KEYS = new Set(["courseCode", "status", "term", "credits"]);

class InputError extends Error {}

interface ImportCourseInput {
  courseCode: string;
  status: CourseRecordStatus;
  term: string | null;
  credits: number | null;
}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function exactKeys(value: Record<string, unknown>, keys: Set<string>, label: string) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new InputError(`${label} contains unsupported field: ${key}.`);
  }
}

function parseStatus(value: unknown, label: string): CourseRecordStatus {
  if (
    typeof value !== "string" ||
    !COURSE_RECORD_STATUSES.includes(value as CourseRecordStatus)
  ) {
    throw new InputError(
      `${label}.status must be one of: ${COURSE_RECORD_STATUSES.join(", ")}.`,
    );
  }
  return value as CourseRecordStatus;
}

function parseTerm(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 32) {
    throw new InputError(`${label}.term must be a short academic term.`);
  }
  const cleaned = value.trim().replace(/\s+/g, " ");
  const seasonFirst = cleaned.match(/^(Winter|Spring|Fall)[ -](\d{4})$/i);
  const yearFirst = cleaned.match(/^(\d{4})[ -](Winter|Spring|Fall)$/i);
  const year = seasonFirst?.[2] ?? yearFirst?.[1];
  const season = seasonFirst?.[1] ?? yearFirst?.[2];
  if (!year || !season || Number(year) < 2000 || Number(year) > 9999) {
    throw new InputError(
      `${label}.term must use YYYY-Fall, YYYY-Winter, or YYYY-Spring.`,
    );
  }
  return `${year}-${season[0].toUpperCase()}${season.slice(1).toLowerCase()}`;
}

function parseInputCredits(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InputError(`${label}.credits must be a finite number.`);
  }
  const credits = Math.round(value * 100) / 100;
  if (credits < 0 || credits > 5 || Math.abs(value - credits) > 1e-9) {
    throw new InputError(
      `${label}.credits must be between 0 and 5 with at most two decimals.`,
    );
  }
  return credits;
}

function parseCourse(value: unknown, index: number): ImportCourseInput {
  const label = `courses[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  exactKeys(record, COURSE_KEYS, label);
  const rawCode = typeof record.courseCode === "string"
    ? record.courseCode.trim()
    : "";
  if (!rawCode || rawCode.length > MAX_COURSE_CODE_LENGTH) {
    throw new InputError(`${label}.courseCode is required and is too long.`);
  }
  const courseCode = normalizeCourseCode(rawCode);
  if (!courseCode) throw new InputError(`${label}.courseCode is invalid.`);
  const status = parseStatus(record.status, label);
  const term = parseTerm(record.term, label);
  if ((status === "planned" || status === "in_progress") && !term) {
    throw new InputError(`${label}.term is required for planned and in-progress courses.`);
  }
  return {
    courseCode,
    status,
    term,
    credits: parseInputCredits(record.credits, label),
  };
}

async function readCourses(request: Request): Promise<ImportCourseInput[]> {
  try {
    const body = await readBoundedJsonObject(request, MAX_BODY_BYTES);
    exactKeys(body, BODY_KEYS, "body");
    if (
      !Array.isArray(body.courses) ||
      body.courses.length === 0 ||
      body.courses.length > MAX_IMPORT_COURSES
    ) {
      throw new InputError(
        `courses must contain between 1 and ${MAX_IMPORT_COURSES} courses.`,
      );
    }
    return body.courses.map(parseCourse);
  } catch (error) {
    if (error instanceof JsonBodyError) throw new InputError(error.message);
    throw error;
  }
}

function catalogCredits(input: ImportCourseInput, course: AcademicCourse): number | null {
  const credits = input.credits ?? course.credits ?? course.creditMin ?? null;
  if (credits != null && course.creditMin != null && credits < course.creditMin) {
    throw new InputError(
      `${course.code} units cannot be below the catalog minimum of ${course.creditMin}.`,
    );
  }
  if (credits != null && course.creditMax != null && credits > course.creditMax) {
    throw new InputError(
      `${course.code} units cannot exceed the catalog maximum of ${course.creditMax}.`,
    );
  }
  return credits;
}

function calendarYear(metadata: CatalogMetadata): number {
  const match = metadata.calendarLabel.match(/\b(?:19|20)\d{2}\b/);
  if (!match) throw new AcademicDataError("The academic calendar year is invalid.");
  return Number(match[0]);
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && /unique constraint|course_records_user_course_term_uq/i.test(
    `${error.message}\n${error.cause instanceof Error ? error.cause.message : ""}`,
  );
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

    const inputs = await readCourses(request);
    const academicEnv = env as unknown as AcademicEnvironment;
    const [metadata, catalogCourses, existing] = await Promise.all([
      getCatalogMetadata(academicEnv),
      Promise.all(inputs.map((input) => getCourseByCode(academicEnv, input.courseCode))),
      getUserDb()
        .select()
        .from(courseRecords)
        .where(eq(courseRecords.userId, session.user.localId)),
    ]);

    const rows = inputs.map((input, index) => {
      const course = catalogCourses[index];
      if (!course) {
        throw new InputError(
          `${input.courseCode} is not available in the active academic calendar.`,
        );
      }
      return { input, course, credits: catalogCredits(input, course) };
    });
    const importedKeys = new Set<string>();
    for (const row of rows) {
      const key = `${row.course.code}\u0000${row.input.term ?? ""}`;
      if (importedKeys.has(key)) {
        throw new InputError(
          `${row.course.code} appears more than once for ${row.input.term ?? "an unscheduled term"}.`,
        );
      }
      importedKeys.add(key);
      if (
        existing.some(
          (record) =>
            record.courseCode === row.course.code && record.term === row.input.term,
        )
      ) {
        return errorResponse(
          "COURSE_ALREADY_RECORDED",
          `${row.course.code} is already recorded for ${row.input.term ?? "an unscheduled term"}.`,
          409,
        );
      }
    }

    const db = getUserDb();
    const now = Date.now();
    const year = calendarYear(metadata);
    const statements = rows.map(({ input, course, credits }) =>
      db.insert(courseRecords).values({
        id: crypto.randomUUID(),
        userId: session.user.localId,
        catalogId: metadata.catalogId,
        coursePid: course.pid,
        courseVersionId: course.versionId,
        courseCode: course.code,
        courseTitle: course.title,
        status: input.status,
        term: input.term,
        grade: null,
        credits,
        calendarYear: year,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await db.batch([statements[0], ...statements.slice(1)]);

    return Response.json(
      { success: true, imported: rows.length },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InputError) {
      return errorResponse("INVALID_INPUT", error.message, 400);
    }
    if (isUniqueConflict(error)) {
      return errorResponse(
        "COURSE_ALREADY_RECORDED",
        "One of these courses is already recorded for that term.",
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
    return errorResponse("INTERNAL_ERROR", "Unable to import the courses.", 500);
  }
}
