import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import { userPrograms } from "@/db/schema";
import {
  AcademicDataError,
  getCatalogMetadata,
  getProgramByCode,
} from "@/lib/academic";
import { getLocalSession, isSameOriginMutation } from "@/lib/auth";
import { JsonBodyError, readBoundedJsonObject } from "@/lib/http";
import type { AcademicEnvironment, CatalogMetadata } from "@/lib/types";

const MAX_BODY_BYTES = 8_192;
const MAX_PROGRAM_CODE_LENGTH = 128;
const BODY_KEYS = new Set(["programCode"]);

class InputError extends Error {}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function calendarYear(metadata: CatalogMetadata): number {
  const match = metadata.calendarLabel.match(/\b(?:19|20)\d{2}\b/);
  if (!match) {
    throw new AcademicDataError(
      "The configured academic calendar does not have a recognizable year.",
    );
  }
  return Number(match[0]);
}

function publicProgram(record: typeof userPrograms.$inferSelect | undefined) {
  if (!record) return null;
  const { userId: _userId, ...program } = record;
  void _userId;
  return program;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await readBoundedJsonObject(request, MAX_BODY_BYTES);
    for (const key of Object.keys(body)) {
      if (!BODY_KEYS.has(key)) {
        throw new InputError(`Unsupported request field: ${key}.`);
      }
    }
    return body;
  } catch (error) {
    if (error instanceof JsonBodyError) throw new InputError(error.message);
    throw error;
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
    const programCode =
      typeof body.programCode === "string" ? body.programCode.trim() : "";
    if (
      !programCode ||
      programCode.length > MAX_PROGRAM_CODE_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(programCode)
    ) {
      throw new InputError("programCode is required and must be a valid catalog code.");
    }

    const academicEnv = env as unknown as AcademicEnvironment;
    const [catalogProgram, metadata] = await Promise.all([
      getProgramByCode(academicEnv, programCode),
      getCatalogMetadata(academicEnv),
    ]);
    if (!catalogProgram) {
      return errorResponse(
        "PROGRAM_NOT_FOUND",
        "That program is not available in the active academic calendar.",
        404,
      );
    }

    const year = calendarYear(metadata);
    const now = Date.now();
    const db = getUserDb();
    const snapshot = {
      catalogId: metadata.catalogId,
      programPid: catalogProgram.pid,
      programVersionId: catalogProgram.versionId,
      programCode: catalogProgram.code,
      programName: catalogProgram.title,
      calendarYear: year,
      programType: (
        catalogProgram.programTypeUndergraduate ??
        catalogProgram.undergraduateCredentialType ??
        catalogProgram.graduateCredentialType ??
        catalogProgram.career ??
        "program"
      ).slice(0, 200),
      isPrimary: true,
      updatedAt: now,
    };

    await db.batch([
      db
        .update(userPrograms)
        .set({ isPrimary: false, updatedAt: now })
        .where(eq(userPrograms.userId, session.user.localId)),
      db
        .insert(userPrograms)
        .values({
          id: crypto.randomUUID(),
          userId: session.user.localId,
          ...snapshot,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [
            userPrograms.userId,
            userPrograms.programCode,
            userPrograms.calendarYear,
          ],
          set: snapshot,
        }),
    ]);

    const [selectedProgram] = await db
      .select()
      .from(userPrograms)
      .where(
        and(
          eq(userPrograms.userId, session.user.localId),
          eq(userPrograms.programCode, catalogProgram.code),
          eq(userPrograms.calendarYear, year),
        ),
      )
      .limit(1);

    return Response.json(
      {
        success: true,
        program: publicProgram(selectedProgram),
        catalogProgram,
        calendar: metadata,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InputError) {
      return errorResponse("INVALID_INPUT", error.message, 400);
    }
    if (error instanceof AcademicDataError) {
      return errorResponse(
        "ACADEMIC_CATALOG_UNAVAILABLE",
        "The academic calendar is temporarily unavailable.",
        503,
      );
    }
    return errorResponse("INTERNAL_ERROR", "Unable to save the selected program.", 500);
  }
}
