export const SHARE_LINK_KINDS = ["schedule", "progress"] as const;
export type ShareLinkKind = (typeof SHARE_LINK_KINDS)[number];

export const MAX_SHARE_PAYLOAD_BYTES = 262_144;
export const MAX_SHARE_EXPIRY_MS = 366 * 24 * 60 * 60 * 1_000;

const SCHEDULE_STATUSES = [
  "completed",
  "in_progress",
  "planned",
  "transfer",
] as const;
const PROGRESS_STATUSES = ["met", "planned", "not_met", "unknown"] as const;
const BODY_KEYS = new Set(["kind", "includeGrades", "expiresAt", "snapshot"]);

export type SharedScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export type SharedProgressStatus = (typeof PROGRESS_STATUSES)[number];

export interface SharedScheduleCourse {
  code: string;
  title: string;
  term: string;
  status: SharedScheduleStatus;
  credits: number;
  grade?: number | null;
}

export interface SharedProgressRequirement {
  title: string;
  status: SharedProgressStatus;
  description?: string | null;
  evidence: string[];
  missing: string[];
}

export interface SharedProgressProgram {
  title: string;
  code: string;
  credential?: string | null;
  faculty?: string | null;
  requirements: SharedProgressRequirement[];
}

export type ShareSnapshotData =
  | { courses: SharedScheduleCourse[] }
  | { programs: SharedProgressProgram[] };

export type PublicShareSnapshot =
  | {
      kind: "schedule";
      ownerName: string;
      createdAt: number;
      expiresAt: number | null;
      includeGrades: boolean;
      courses: SharedScheduleCourse[];
    }
  | {
      kind: "progress";
      ownerName: string;
      createdAt: number;
      expiresAt: number | null;
      includeGrades: false;
      programs: SharedProgressProgram[];
    };

export interface ParsedShareCreateInput {
  kind: ShareLinkKind;
  includeGrades: boolean;
  expiresAt: number | null;
  snapshot: ShareSnapshotData;
  serializedSnapshot: string;
}

export class ShareInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareInputError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ShareInputError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ShareInputError(`Unsupported ${label} field: ${key}.`);
    }
  }
}

function text(
  value: unknown,
  label: string,
  maximumLength: number,
  optional = false,
): string | null {
  if (optional && (value === null || value === undefined || value === "")) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ShareInputError(`${label} must be text.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    normalized.length > maximumLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
  ) {
    throw new ShareInputError(`${label} is invalid.`);
  }
  return normalized;
}

function finiteNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ShareInputError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return Math.round(value * 100) / 100;
}

function stringList(
  value: unknown,
  label: string,
  maximumItems: number,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new ShareInputError(`${label} must contain at most ${maximumItems} items.`);
  }
  return value.map((item, index) =>
    text(item, `${label}[${index}]`, 256) as string,
  );
}

function parseScheduleSnapshot(
  value: unknown,
  includeGrades: boolean,
): { courses: SharedScheduleCourse[] } {
  const snapshot = record(value, "snapshot");
  exactKeys(snapshot, new Set(["courses"]), "snapshot");
  if (!Array.isArray(snapshot.courses) || snapshot.courses.length > 500) {
    throw new ShareInputError("snapshot.courses must contain at most 500 courses.");
  }
  const courses = snapshot.courses.map((value, index) => {
    const course = record(value, `snapshot.courses[${index}]`);
    exactKeys(
      course,
      new Set(["code", "title", "term", "status", "credits", "grade"]),
      `snapshot.courses[${index}]`,
    );
    if (
      typeof course.status !== "string" ||
      !SCHEDULE_STATUSES.includes(course.status as SharedScheduleStatus)
    ) {
      throw new ShareInputError(`snapshot.courses[${index}].status is invalid.`);
    }
    const parsed: SharedScheduleCourse = {
      code: text(course.code, `snapshot.courses[${index}].code`, 32) as string,
      title: text(course.title, `snapshot.courses[${index}].title`, 256) as string,
      term: text(course.term, `snapshot.courses[${index}].term`, 64) as string,
      status: course.status as SharedScheduleStatus,
      credits: finiteNumber(
        course.credits,
        `snapshot.courses[${index}].credits`,
        0,
        10,
      ),
    };
    if (includeGrades) {
      parsed.grade = course.grade == null
        ? null
        : finiteNumber(course.grade, `snapshot.courses[${index}].grade`, 0, 100);
    }
    return parsed;
  });
  return { courses };
}

function parseProgressSnapshot(value: unknown): { programs: SharedProgressProgram[] } {
  const snapshot = record(value, "snapshot");
  exactKeys(snapshot, new Set(["programs"]), "snapshot");
  if (!Array.isArray(snapshot.programs) || snapshot.programs.length > 20) {
    throw new ShareInputError("snapshot.programs must contain at most 20 plans.");
  }
  return {
    programs: snapshot.programs.map((value, programIndex) => {
      const program = record(value, `snapshot.programs[${programIndex}]`);
      exactKeys(
        program,
        new Set(["title", "code", "credential", "faculty", "requirements"]),
        `snapshot.programs[${programIndex}]`,
      );
      if (!Array.isArray(program.requirements) || program.requirements.length > 200) {
        throw new ShareInputError(
          `snapshot.programs[${programIndex}].requirements must contain at most 200 items.`,
        );
      }
      return {
        title: text(
          program.title,
          `snapshot.programs[${programIndex}].title`,
          256,
        ) as string,
        code: text(
          program.code,
          `snapshot.programs[${programIndex}].code`,
          64,
        ) as string,
        credential: text(
          program.credential,
          `snapshot.programs[${programIndex}].credential`,
          256,
          true,
        ),
        faculty: text(
          program.faculty,
          `snapshot.programs[${programIndex}].faculty`,
          256,
          true,
        ),
        requirements: program.requirements.map((value, requirementIndex) => {
          const requirement = record(
            value,
            `snapshot.programs[${programIndex}].requirements[${requirementIndex}]`,
          );
          exactKeys(
            requirement,
            new Set(["title", "status", "description", "evidence", "missing"]),
            `snapshot.programs[${programIndex}].requirements[${requirementIndex}]`,
          );
          if (
            typeof requirement.status !== "string" ||
            !PROGRESS_STATUSES.includes(
              requirement.status as SharedProgressStatus,
            )
          ) {
            throw new ShareInputError(
              `snapshot.programs[${programIndex}].requirements[${requirementIndex}].status is invalid.`,
            );
          }
          return {
            title: text(
              requirement.title,
              `snapshot.programs[${programIndex}].requirements[${requirementIndex}].title`,
              512,
            ) as string,
            status: requirement.status as SharedProgressStatus,
            description: text(
              requirement.description,
              `snapshot.programs[${programIndex}].requirements[${requirementIndex}].description`,
              4_000,
              true,
            ),
            evidence: stringList(
              requirement.evidence,
              `snapshot.programs[${programIndex}].requirements[${requirementIndex}].evidence`,
              100,
            ),
            missing: stringList(
              requirement.missing,
              `snapshot.programs[${programIndex}].requirements[${requirementIndex}].missing`,
              100,
            ),
          };
        }),
      };
    }),
  };
}

function parseKind(value: unknown): ShareLinkKind {
  if (
    typeof value !== "string" ||
    !SHARE_LINK_KINDS.includes(value as ShareLinkKind)
  ) {
    throw new ShareInputError("kind must be schedule or progress.");
  }
  return value as ShareLinkKind;
}

function parseExpiry(value: unknown, now: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new ShareInputError("expiresAt must be an ISO date or null.");
  }
  const expiresAt = Date.parse(value);
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 60_000) {
    throw new ShareInputError("The expiry must be in the future.");
  }
  if (expiresAt > now + MAX_SHARE_EXPIRY_MS) {
    throw new ShareInputError("The expiry must be within one year.");
  }
  return expiresAt;
}

export function parseShareCreateInput(
  input: unknown,
  now = Date.now(),
): ParsedShareCreateInput {
  const body = record(input, "request body");
  exactKeys(body, BODY_KEYS, "request body");
  const kind = parseKind(body.kind);
  const includeGrades = kind === "schedule" && body.includeGrades === true;
  if (body.includeGrades !== undefined && typeof body.includeGrades !== "boolean") {
    throw new ShareInputError("includeGrades must be true or false.");
  }
  const expiresAt = parseExpiry(body.expiresAt, now);
  const snapshot = kind === "schedule"
    ? parseScheduleSnapshot(body.snapshot, includeGrades)
    : parseProgressSnapshot(body.snapshot);
  const serializedSnapshot = JSON.stringify(snapshot);
  if (new TextEncoder().encode(serializedSnapshot).length > MAX_SHARE_PAYLOAD_BYTES) {
    throw new ShareInputError("The shared plan is too large.");
  }
  return {
    kind,
    includeGrades,
    expiresAt,
    snapshot,
    serializedSnapshot,
  };
}

export function parseStoredShareSnapshot(
  payload: string,
  kind: ShareLinkKind,
  includeGrades: boolean,
  ownerName: string,
  createdAt: number,
  expiresAt: number | null,
): PublicShareSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new ShareInputError("The stored share data is invalid.");
  }
  if (kind === "schedule") {
    return {
      kind,
      ownerName,
      createdAt,
      expiresAt,
      includeGrades,
      ...parseScheduleSnapshot(parsed, includeGrades),
    };
  }
  return {
    kind,
    ownerName,
    createdAt,
    expiresAt,
    includeGrades: false,
    ...parseProgressSnapshot(parsed),
  };
}

export function createShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function isShareToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
