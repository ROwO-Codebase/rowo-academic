import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import {
  REQUIREMENT_OVERRIDE_REFERENCE_TYPES,
  REQUIREMENT_OVERRIDE_STATES,
  requirementNodeOverrideReferences,
  requirementNodeOverrides,
  userPrograms,
  type RequirementOverrideReferenceType,
  type RequirementOverrideState,
} from "@/db/schema";
import {
  AcademicDataError,
  getCatalogMetadata,
  getCourseByPid,
  getProgramByPid,
  getProgramRequirementDocuments,
} from "@/lib/academic";
import { getLocalSession, isSameOriginMutation } from "@/lib/auth";
import { JsonBodyError, readBoundedJsonObject } from "@/lib/http";
import {
  findRequirementNodeByKey,
  requirementDocumentSourceKey,
} from "@/lib/requirement-overrides";
import type {
  AcademicEnvironment,
  RequirementNodeManualOverride,
  RequirementNodeManualReference,
} from "@/lib/types";

const MAX_BODY_BYTES = 32_768;
const MAX_NOTE_LENGTH = 4_000;
const MAX_REFERENCES = 20;
const MAX_DOCUMENT_ID_LENGTH = 256;
const MAX_NODE_KEY_LENGTH = 512;
const BODY_KEYS = new Set([
  "userProgramId",
  "documentId",
  "nodeKey",
  "state",
  "note",
  "references",
]);
const REFERENCE_KEYS = new Set(["targetType", "targetPid"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATALOG_PID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

type ReferenceInput = {
  targetType: RequirementOverrideReferenceType;
  targetPid: string;
};

type ReferenceSnapshot = {
  targetType: RequirementOverrideReferenceType;
  targetPid: string;
  targetVersionId: string;
  targetCode: string;
  targetTitle: string;
  credits: number | null;
};

class RequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "RequestError";
    this.code = code;
    this.status = status;
  }
}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await readBoundedJsonObject(request, MAX_BODY_BYTES);
    for (const key of Object.keys(body)) {
      if (!BODY_KEYS.has(key)) {
        throw new RequestError("INVALID_INPUT", `Unsupported request field: ${key}.`);
      }
    }
    return body;
  } catch (error) {
    if (error instanceof JsonBodyError) {
      throw new RequestError("INVALID_INPUT", error.message);
    }
    throw error;
  }
}

function requiredUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RequestError("INVALID_INPUT", `${label} is invalid.`);
  }
  return value;
}

function requiredIdentity(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !normalized ||
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new RequestError("INVALID_INPUT", `${label} is invalid.`);
  }
  return normalized;
}

function parseState(value: unknown): RequirementOverrideState | null {
  if (value == null) return null;
  if (
    typeof value !== "string" ||
    !REQUIREMENT_OVERRIDE_STATES.includes(value as RequirementOverrideState)
  ) {
    throw new RequestError(
      "INVALID_INPUT",
      `state must be null or one of: ${REQUIREMENT_OVERRIDE_STATES.join(", ")}.`,
    );
  }
  return value as RequirementOverrideState;
}

function parseNote(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new RequestError("INVALID_INPUT", "note must be text or null.");
  }
  const note = value.trim();
  if (!note) return null;
  if (note.length > MAX_NOTE_LENGTH || note.includes("\u0000")) {
    throw new RequestError(
      "INVALID_INPUT",
      `note must contain at most ${MAX_NOTE_LENGTH} characters.`,
    );
  }
  return note;
}

function parseReferences(value: unknown): ReferenceInput[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_REFERENCES) {
    throw new RequestError(
      "INVALID_INPUT",
      `references must be an array containing at most ${MAX_REFERENCES} items.`,
    );
  }

  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new RequestError(
        "INVALID_INPUT",
        `references[${index}] must be an object.`,
      );
    }
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!REFERENCE_KEYS.has(key)) {
        throw new RequestError(
          "INVALID_INPUT",
          `Unsupported references[${index}] field: ${key}.`,
        );
      }
    }
    if (
      typeof record.targetType !== "string" ||
      !REQUIREMENT_OVERRIDE_REFERENCE_TYPES.includes(
        record.targetType as RequirementOverrideReferenceType,
      )
    ) {
      throw new RequestError(
        "INVALID_INPUT",
        `references[${index}].targetType must be course or program.`,
      );
    }
    const targetPid =
      typeof record.targetPid === "string" ? record.targetPid.trim() : "";
    if (!CATALOG_PID.test(targetPid)) {
      throw new RequestError(
        "INVALID_INPUT",
        `references[${index}].targetPid is invalid.`,
      );
    }
    const targetType = record.targetType as RequirementOverrideReferenceType;
    const key = `${targetType}\u0000${targetPid}`;
    if (seen.has(key)) {
      throw new RequestError(
        "INVALID_INPUT",
        `references[${index}] duplicates an earlier reference.`,
      );
    }
    seen.add(key);
    return { targetType, targetPid };
  });
}

async function resolveReference(
  academicEnv: AcademicEnvironment,
  catalogId: string,
  reference: ReferenceInput,
): Promise<ReferenceSnapshot> {
  if (reference.targetType === "course") {
    const course = await getCourseByPid(academicEnv, reference.targetPid);
    if (!course || course.catalogId !== catalogId) {
      throw new RequestError(
        "REFERENCE_NOT_FOUND",
        "A referenced course is not available in the active academic calendar.",
        404,
      );
    }
    return {
      targetType: "course",
      targetPid: course.pid,
      targetVersionId: course.versionId,
      targetCode: course.code,
      targetTitle: course.title,
      credits: course.credits ?? course.creditMin ?? null,
    };
  }

  const program = await getProgramByPid(academicEnv, reference.targetPid);
  if (!program || program.catalogId !== catalogId) {
    throw new RequestError(
      "REFERENCE_NOT_FOUND",
      "A referenced program is not available in the active academic calendar.",
      404,
    );
  }
  return {
    targetType: "program",
    targetPid: program.pid,
    targetVersionId: program.versionId,
    targetCode: program.code,
    targetTitle: program.title,
    credits: null,
  };
}

function publicReference(
  reference: typeof requirementNodeOverrideReferences.$inferSelect,
): RequirementNodeManualReference {
  return {
    id: reference.id,
    targetType: reference.targetType,
    targetPid: reference.targetPid,
    targetVersionId: reference.targetVersionId,
    targetCode: reference.targetCode,
    targetTitle: reference.targetTitle,
    credits: reference.credits,
    resolutionStatus: "resolved",
  };
}

function publicOverride(
  override: typeof requirementNodeOverrides.$inferSelect,
  references: Array<typeof requirementNodeOverrideReferences.$inferSelect>,
): RequirementNodeManualOverride {
  return {
    id: override.id,
    documentId: override.documentId,
    nodeKey: override.nodeKey,
    state: override.state,
    note: override.note,
    references: references.map(publicReference),
    updatedAt: override.updatedAt,
  };
}

async function stableOverrideId(parts: string[]): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(parts)),
  ));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export async function PUT(request: Request) {
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
    const userProgramId = requiredUuid(body.userProgramId, "userProgramId");
    const documentId = requiredIdentity(
      body.documentId,
      "documentId",
      MAX_DOCUMENT_ID_LENGTH,
    );
    const nodeKey = requiredIdentity(body.nodeKey, "nodeKey", MAX_NODE_KEY_LENGTH);
    const state = parseState(body.state);
    const note = parseNote(body.note);
    const referenceInputs = parseReferences(body.references);
    if (state == null && note == null && referenceInputs.length === 0) {
      throw new RequestError(
        "INVALID_INPUT",
        "At least one manual status, note, or reference is required.",
      );
    }

    const db = getUserDb();
    const [savedProgram] = await db
      .select()
      .from(userPrograms)
      .where(
        and(
          eq(userPrograms.id, userProgramId),
          eq(userPrograms.userId, session.user.localId),
        ),
      )
      .limit(1);
    if (!savedProgram) {
      return errorResponse("PROGRAM_NOT_FOUND", "Tracked plan not found.", 404);
    }

    const academicEnv = env as unknown as AcademicEnvironment;
    const [metadata, catalogProgram, documents] = await Promise.all([
      getCatalogMetadata(academicEnv),
      getProgramByPid(academicEnv, savedProgram.programPid),
      getProgramRequirementDocuments(academicEnv, savedProgram.programPid),
    ]);
    if (savedProgram.catalogId !== metadata.catalogId) {
      return errorResponse(
        "CALENDAR_MISMATCH",
        "This tracked plan belongs to a different academic calendar.",
        409,
      );
    }
    if (
      !catalogProgram ||
      catalogProgram.catalogId !== metadata.catalogId ||
      catalogProgram.versionId !== savedProgram.programVersionId
    ) {
      return errorResponse(
        "STALE_PROGRAM",
        "The tracked plan no longer matches the active catalog version.",
        409,
      );
    }

    const document = documents.find((candidate) => candidate.documentId === documentId);
    if (
      !document ||
      document.catalogId !== savedProgram.catalogId ||
      document.ownerPid !== savedProgram.programPid ||
      document.ownerVersionId !== savedProgram.programVersionId
    ) {
      return errorResponse(
        "REQUIREMENT_NODE_NOT_FOUND",
        "The requirement node is not available for this tracked plan.",
        404,
      );
    }
    const documentSourceHash = await requirementDocumentSourceKey(document);
    const root = document.ast.root;
    const node = root ? findRequirementNodeByKey(root, nodeKey) : null;
    if (!node) {
      return errorResponse(
        "REQUIREMENT_NODE_NOT_FOUND",
        "The requirement node is not available for this tracked plan.",
        404,
      );
    }

    const referenceSnapshots = await Promise.all(
      referenceInputs.map((reference) =>
        resolveReference(academicEnv, metadata.catalogId, reference),
      ),
    );
    const now = Date.now();
    const overrideIdentity = and(
      eq(requirementNodeOverrides.userId, session.user.localId),
      eq(requirementNodeOverrides.userProgramId, savedProgram.id),
      eq(requirementNodeOverrides.catalogId, savedProgram.catalogId),
      eq(requirementNodeOverrides.programVersionId, savedProgram.programVersionId),
      eq(requirementNodeOverrides.documentId, document.documentId),
      eq(requirementNodeOverrides.documentSourceHash, documentSourceHash),
      eq(requirementNodeOverrides.nodeKey, nodeKey),
    );
    const [existingOverride] = await db
      .select({
        id: requirementNodeOverrides.id,
        createdAt: requirementNodeOverrides.createdAt,
      })
      .from(requirementNodeOverrides)
      .where(overrideIdentity)
      .limit(1);
    const overrideId = existingOverride?.id ?? await stableOverrideId([
      session.user.localId,
      savedProgram.id,
      savedProgram.catalogId,
      savedProgram.programVersionId,
      document.documentId,
      documentSourceHash,
      nodeKey,
    ]);
    const saveOverride = db
      .insert(requirementNodeOverrides)
      .values({
        id: overrideId,
        userId: session.user.localId,
        userProgramId: savedProgram.id,
        catalogId: savedProgram.catalogId,
        programVersionId: savedProgram.programVersionId,
        documentId: document.documentId,
        documentSourceHash,
        nodeKey,
        nodeId:
          typeof node.node_id === "string" && node.node_id.trim()
            ? node.node_id.trim()
            : null,
        state,
        note,
        createdAt: existingOverride?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: requirementNodeOverrides.id,
        set: {
          nodeId:
            typeof node.node_id === "string" && node.node_id.trim()
              ? node.node_id.trim()
              : null,
          state,
          note,
          updatedAt: now,
        },
      });
    const deleteReferences = db
      .delete(requirementNodeOverrideReferences)
      .where(eq(requirementNodeOverrideReferences.overrideId, overrideId));
    if (referenceSnapshots.length === 0) {
      await db.batch([saveOverride, deleteReferences]);
    } else {
      await db.batch([
        saveOverride,
        deleteReferences,
        db.insert(requirementNodeOverrideReferences).values(
          referenceSnapshots.map((reference) => ({
            id: crypto.randomUUID(),
            overrideId,
            ...reference,
            createdAt: now,
          })),
        ),
      ]);
    }

    const [override] = await db
      .select()
      .from(requirementNodeOverrides)
      .where(
        and(
          eq(requirementNodeOverrides.id, overrideId),
          eq(requirementNodeOverrides.userId, session.user.localId),
        ),
      )
      .limit(1);
    if (!override) {
      throw new Error("The requirement override was not saved.");
    }

    const savedReferences = await db
      .select()
      .from(requirementNodeOverrideReferences)
      .where(eq(requirementNodeOverrideReferences.overrideId, overrideId));
    return Response.json(
      { success: true, override: publicOverride(override, savedReferences) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof RequestError) {
      return errorResponse(error.code, error.message, error.status);
    }
    if (error instanceof AcademicDataError) {
      return errorResponse(
        "ACADEMIC_CATALOG_UNAVAILABLE",
        "The academic calendar is temporarily unavailable.",
        503,
      );
    }
    return errorResponse(
      "INTERNAL_ERROR",
      "Unable to save the requirement override.",
      500,
    );
  }
}
