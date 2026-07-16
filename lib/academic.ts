import type {
  AcademicCatalogConfig,
  AcademicCourse,
  AcademicD1Database,
  AcademicEnvironment,
  AcademicProgram,
  CatalogMetadata,
  CourseSearchOptions,
  ProgramSearchOptions,
  RequirementAst,
  RequirementDocument,
  RequirementOwnerType,
  RequirementParseStatus,
} from "./types";

export const DEFAULT_ACADEMIC_CATALOG_ID = "663290e835aff7001cc62323";
export const DEFAULT_ACADEMIC_CALENDAR_LABEL = "2026";

type QueryRow = Record<string, unknown>;

export class AcademicDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademicDataError";
  }
}

interface QueryBackend {
  select<Row extends QueryRow>(sql: string, params?: unknown[]): Promise<Row[]>;
}

export interface AcademicRepository {
  readonly config: AcademicCatalogConfig;
  getCatalogMetadata(): Promise<CatalogMetadata>;
  searchCourses(options?: CourseSearchOptions): Promise<AcademicCourse[]>;
  getCourseByCode(code: string): Promise<AcademicCourse | null>;
  getCourseByPid(pid: string): Promise<AcademicCourse | null>;
  searchPrograms(options?: ProgramSearchOptions): Promise<AcademicProgram[]>;
  getProgramByCode(code: string): Promise<AcademicProgram | null>;
  getProgramByPid(pid: string): Promise<AcademicProgram | null>;
  getCourseRequirementDocuments(pidOrCode: string): Promise<RequirementDocument[]>;
  getProgramRequirementDocuments(pidOrCode: string): Promise<RequirementDocument[]>;
}

export function createAcademicRepository(
  environment: AcademicEnvironment,
  overrides: Partial<AcademicCatalogConfig> = {},
): AcademicRepository {
  const config = resolveAcademicCatalogConfig(environment, overrides);
  const backend = createQueryBackend(environment);

  return {
    config,
    getCatalogMetadata: () => queryCatalogMetadata(backend, config),
    searchCourses: (options = {}) => queryCourses(backend, config, options),
    getCourseByCode: (code) => queryCourseByCode(backend, config, code),
    getCourseByPid: (pid) => queryCourseByPid(backend, config, pid),
    searchPrograms: (options = {}) => queryPrograms(backend, config, options),
    getProgramByCode: (code) => queryProgramByCode(backend, config, code),
    getProgramByPid: (pid) => queryProgramByPid(backend, config, pid),
    getCourseRequirementDocuments: async (pidOrCode) => {
      const pid = await resolveCoursePid(backend, config, pidOrCode);
      if (!pid) return [];
      const [documents, presence] = await Promise.all([
        queryRequirementDocuments(backend, config, "courses", pid),
        queryCourseRequirementPresence(backend, config, pid),
      ]);
      return withMissingCourseRequirementGuards(documents, presence, config);
    },
    getProgramRequirementDocuments: async (pidOrCode) => {
      const pid = await resolveProgramPid(backend, config, pidOrCode);
      return pid ? queryRequirementDocuments(backend, config, "programs", pid) : [];
    },
  };
}

export function resolveAcademicCatalogConfig(
  environment: AcademicEnvironment,
  overrides: Partial<AcademicCatalogConfig> = {},
): AcademicCatalogConfig {
  const catalogId = cleanString(
    overrides.catalogId ?? environment.ACADEMIC_CATALOG_ID,
  ) ?? DEFAULT_ACADEMIC_CATALOG_ID;
  const calendarLabel = cleanString(
    overrides.calendarLabel ??
      environment.ACADEMIC_CALENDAR_LABEL ??
      environment.ACADEMIC_CALENDAR_YEAR,
  ) ?? DEFAULT_ACADEMIC_CALENDAR_LABEL;

  return { catalogId, calendarLabel };
}

export async function getCatalogMetadata(
  environment: AcademicEnvironment,
  overrides?: Partial<AcademicCatalogConfig>,
): Promise<CatalogMetadata> {
  return createAcademicRepository(environment, overrides).getCatalogMetadata();
}

export async function searchCourses(
  environment: AcademicEnvironment,
  options: CourseSearchOptions = {},
  overrides?: Partial<AcademicCatalogConfig>,
): Promise<AcademicCourse[]> {
  return createAcademicRepository(environment, overrides).searchCourses(options);
}

export async function getCourseByCode(
  environment: AcademicEnvironment,
  code: string,
  overrides?: Partial<AcademicCatalogConfig>,
): Promise<AcademicCourse | null> {
  return createAcademicRepository(environment, overrides).getCourseByCode(code);
}

export async function getCourseByPid(
  environment: AcademicEnvironment,
  pid: string,
  overrides?: Partial<AcademicCatalogConfig>,
): Promise<AcademicCourse | null> {
  return createAcademicRepository(environment, overrides).getCourseByPid(pid);
}

export async function searchPrograms(
  environment: AcademicEnvironment,
  options: ProgramSearchOptions = {},
  overrides?: Partial<AcademicCatalogConfig>,
): Promise<AcademicProgram[]> {
  return createAcademicRepository(environment, overrides).searchPrograms(options);
}

export async function getProgramByCode(
  environment: AcademicEnvironment,
  code: string,
  overrides?: Partial<AcademicCatalogConfig>,
): Promise<AcademicProgram | null> {
  return createAcademicRepository(environment, overrides).getProgramByCode(code);
}

export async function getProgramByPid(
  environment: AcademicEnvironment,
  pid: string,
  overrides?: Partial<AcademicCatalogConfig>,
): Promise<AcademicProgram | null> {
  return createAcademicRepository(environment, overrides).getProgramByPid(pid);
}

export async function getCourseRequirementDocuments(
  environment: AcademicEnvironment,
  pidOrCode: string,
  overrides?: Partial<AcademicCatalogConfig>,
): Promise<RequirementDocument[]> {
  return createAcademicRepository(environment, overrides)
    .getCourseRequirementDocuments(pidOrCode);
}

export async function getProgramRequirementDocuments(
  environment: AcademicEnvironment,
  pidOrCode: string,
  overrides?: Partial<AcademicCatalogConfig>,
): Promise<RequirementDocument[]> {
  return createAcademicRepository(environment, overrides)
    .getProgramRequirementDocuments(pidOrCode);
}

function createQueryBackend(environment: AcademicEnvironment): QueryBackend {
  if (environment.ACADEMIC_DB) {
    return new DirectD1Backend(environment.ACADEMIC_DB);
  }

  const databaseId = cleanString(environment.ACADEMIC_DB_ID);
  const accountId = cleanString(environment.CF_ACCOUNT_ID);
  const token = cleanString(environment.CF_D1_API_TOKEN);
  if (databaseId && accountId && token) {
    return new RestD1Backend(accountId, databaseId, token);
  }

  throw new AcademicDataError(
    "Academic calendar access is unavailable. Bind `ACADEMIC_DB`, or provide ACADEMIC_DB_ID, CF_ACCOUNT_ID, and CF_D1_API_TOKEN for the read-only REST fallback.",
  );
}

class DirectD1Backend implements QueryBackend {
  constructor(private readonly database: AcademicD1Database) {}

  async select<Row extends QueryRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<Row[]> {
    assertReadOnly(sql);
    const result = await this.database.prepare(sql).bind(...params).all<Row>();
    if (result.success === false) {
      throw new AcademicDataError(result.error ?? "Academic D1 query failed.");
    }
    return result.results ?? [];
  }
}

class RestD1Backend implements QueryBackend {
  constructor(
    private readonly accountId: string,
    private readonly databaseId: string,
    private readonly token: string,
  ) {}

  async select<Row extends QueryRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<Row[]> {
    assertReadOnly(sql);
    const endpoint =
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}` +
      `/d1/database/${encodeURIComponent(this.databaseId)}/query`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
    const payload = await response.json() as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
      result?: Array<{ success?: boolean; results?: Row[]; error?: string }>;
    };
    const queryResult = payload.result?.[0];
    if (!response.ok || payload.success === false || queryResult?.success === false) {
      const message =
        queryResult?.error ?? payload.errors?.[0]?.message ??
        `Academic D1 REST query failed with status ${response.status}.`;
      throw new AcademicDataError(message);
    }
    return queryResult?.results ?? [];
  }
}

async function queryCatalogMetadata(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
): Promise<CatalogMetadata> {
  const rows = await backend.select<QueryRow>(
    `SELECT source.item_type, source.collection_url, source.last_crawled_at,
            source.item_count, source.detail_count, source.details_complete,
            (SELECT max(run.generated_at)
               FROM requirement_serialization_runs AS run
              WHERE run.catalog_id = source.catalog_id) AS generated_at
       FROM catalog_sources AS source
      WHERE source.catalog_id = ?1
      ORDER BY source.item_type`,
    [config.catalogId],
  );
  if (rows.length === 0) {
    throw new AcademicDataError(
      `Academic catalog ${config.catalogId} was not found in the configured database.`,
    );
  }

  const completeRequiredSources = new Set(
    rows
      .filter((row) => toBoolean(row.details_complete))
      .map((row) => String(row.item_type)),
  );
  if (
    !completeRequiredSources.has("courses") ||
    !completeRequiredSources.has("programs")
  ) {
    throw new AcademicDataError(
      `Academic catalog ${config.catalogId} does not have complete course and program details.`,
    );
  }

  return {
    catalogId: config.catalogId,
    calendarLabel: config.calendarLabel,
    generatedAt: nullableString(rows[0].generated_at),
    sources: rows.map((row) => ({
      itemType: String(row.item_type) as "courses" | "programs" | "policies",
      collectionUrl: String(row.collection_url),
      lastCrawledAt: String(row.last_crawled_at),
      itemCount: toInteger(row.item_count) ?? 0,
      detailCount: toInteger(row.detail_count) ?? 0,
      detailsComplete: toBoolean(row.details_complete),
    })),
  };
}

async function queryCourses(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  options: CourseSearchOptions,
): Promise<AcademicCourse[]> {
  const clauses = ["catalog_id = ?", "in_catalog = 1", "details_loaded = 1"];
  const params: unknown[] = [config.catalogId];
  const query = cleanString(options.query);
  const normalizedQuery = query ? normalizeLookupCode(query) : "";
  if (query) {
    clauses.push(
      "(catalog_course_id LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' COLLATE NOCASE)",
    );
    params.push(`${escapeLike(normalizedQuery)}%`, `%${escapeLike(query)}%`);
  }
  if (cleanString(options.subjectCode)) {
    clauses.push("subject_code = ? COLLATE NOCASE");
    params.push(cleanString(options.subjectCode));
  }
  if (cleanString(options.courseLevel)) {
    clauses.push("course_level = ?");
    params.push(cleanString(options.courseLevel));
  }
  const limit = boundedInteger(options.limit, 25, 1, 100);
  const offset = boundedInteger(options.offset, 0, 0, 100_000);
  params.push(limit, offset);

  const rows = await backend.select<QueryRow>(
    `${courseColumns()}
       FROM courses
      WHERE ${clauses.join(" AND ")}
      ORDER BY catalog_course_id
      LIMIT ? OFFSET ?`,
    params,
  );
  return rows.map(mapCourse);
}

async function queryCourseByCode(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  code: string,
): Promise<AcademicCourse | null> {
  const normalized = normalizeLookupCode(code);
  if (!normalized) return null;
  const rows = await backend.select<QueryRow>(
    `${courseColumns(true)}
      FROM courses_full
      WHERE catalog_id = ?1 AND in_catalog = 1 AND details_loaded = 1
        AND catalog_course_id = ?2 COLLATE NOCASE
      LIMIT 1`,
    [config.catalogId, normalized],
  );
  return rows[0] ? mapCourse(rows[0]) : null;
}

async function queryCourseByPid(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  pid: string,
): Promise<AcademicCourse | null> {
  const value = cleanString(pid);
  if (!value) return null;
  const rows = await backend.select<QueryRow>(
    `${courseColumns(true)}
      FROM courses_full
      WHERE catalog_id = ?1 AND in_catalog = 1 AND details_loaded = 1 AND pid = ?2
      LIMIT 1`,
    [config.catalogId, value],
  );
  return rows[0] ? mapCourse(rows[0]) : null;
}

async function queryPrograms(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  options: ProgramSearchOptions,
): Promise<AcademicProgram[]> {
  const clauses = ["catalog_id = ?", "in_catalog = 1", "details_loaded = 1"];
  const params: unknown[] = [config.catalogId];
  const query = cleanString(options.query);
  if (query) {
    clauses.push(
      "(program_code LIKE ? ESCAPE '\\' COLLATE NOCASE OR title LIKE ? ESCAPE '\\' COLLATE NOCASE)",
    );
    params.push(`%${escapeLike(query)}%`, `%${escapeLike(query)}%`);
  }
  if (cleanString(options.faculty)) {
    clauses.push("faculty = ? COLLATE NOCASE");
    params.push(cleanString(options.faculty));
  }
  if (cleanString(options.credentialType)) {
    clauses.push(
      "(undergraduate_credential_type = ? COLLATE NOCASE OR graduate_credential_type = ? COLLATE NOCASE)",
    );
    params.push(cleanString(options.credentialType), cleanString(options.credentialType));
  }
  if (cleanString(options.career)) {
    clauses.push("career = ? COLLATE NOCASE");
    params.push(cleanString(options.career));
  }
  const limit = boundedInteger(options.limit, 25, 1, 100);
  const offset = boundedInteger(options.offset, 0, 0, 100_000);
  params.push(limit, offset);

  const rows = await backend.select<QueryRow>(
    `${programColumns()}
       FROM programs
      WHERE ${clauses.join(" AND ")}
      ORDER BY title, program_code
      LIMIT ? OFFSET ?`,
    params,
  );
  return rows.map(mapProgram);
}

async function queryProgramByCode(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  code: string,
): Promise<AcademicProgram | null> {
  const value = cleanString(code);
  if (!value) return null;
  const rows = await backend.select<QueryRow>(
    `${programColumns(true)}
      FROM programs_full
      WHERE catalog_id = ?1 AND in_catalog = 1 AND details_loaded = 1
        AND program_code = ?2 COLLATE NOCASE
      LIMIT 1`,
    [config.catalogId, value],
  );
  return rows[0] ? mapProgram(rows[0]) : null;
}

async function queryProgramByPid(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  pid: string,
): Promise<AcademicProgram | null> {
  const value = cleanString(pid);
  if (!value) return null;
  const rows = await backend.select<QueryRow>(
    `${programColumns(true)}
      FROM programs_full
      WHERE catalog_id = ?1 AND in_catalog = 1 AND details_loaded = 1 AND pid = ?2
      LIMIT 1`,
    [config.catalogId, value],
  );
  return rows[0] ? mapProgram(rows[0]) : null;
}

async function resolveCoursePid(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  pidOrCode: string,
): Promise<string | null> {
  const value = cleanString(pidOrCode);
  if (!value) return null;
  const rows = await backend.select<QueryRow>(
    `SELECT pid
      FROM courses
      WHERE catalog_id = ?1 AND in_catalog = 1 AND details_loaded = 1
        AND (pid = ?2 OR catalog_course_id = ?3 COLLATE NOCASE)
      ORDER BY CASE WHEN pid = ?2 THEN 0 ELSE 1 END
      LIMIT 1`,
    [config.catalogId, value, normalizeLookupCode(value)],
  );
  return nullableString(rows[0]?.pid);
}

async function resolveProgramPid(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  pidOrCode: string,
): Promise<string | null> {
  const value = cleanString(pidOrCode);
  if (!value) return null;
  const rows = await backend.select<QueryRow>(
    `SELECT pid
      FROM programs
      WHERE catalog_id = ?1 AND in_catalog = 1 AND details_loaded = 1
        AND (pid = ?2 OR program_code = ?2 COLLATE NOCASE)
      ORDER BY CASE WHEN pid = ?2 THEN 0 ELSE 1 END
      LIMIT 1`,
    [config.catalogId, value],
  );
  return nullableString(rows[0]?.pid);
}

async function queryRequirementDocuments(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  ownerType: RequirementOwnerType,
  ownerPid: string,
): Promise<RequirementDocument[]> {
  const view = ownerType === "courses" ? "course_requirements" : "program_requirements";
  const rows = await backend.select<QueryRow>(
    `SELECT document_id, catalog_id, owner_type, owner_pid, owner_version_id,
            owner_code, requirement_kind, source_field, source_format,
            parse_status, evaluability, warnings_json, ast_json, source_html,
            source_matches_current_payload
       FROM ${view}
      WHERE catalog_id = ?1 AND owner_pid = ?2
      ORDER BY requirement_kind, source_field`,
    [config.catalogId, ownerPid],
  );
  return rows.map(mapRequirementDocument);
}

function courseColumns(full = false): string {
  return `SELECT catalog_id, pid, version_id, catalog_course_id, course_number,
                 title, subject_code, subject_description, course_level,
                 credit_value, credit_min, credit_max, date_start, date_end, status${
                   full ? ", description, notes_html" : ""
                 }`;
}

type CourseRequirementPresence = {
  ownerPid: string;
  ownerVersionId: string;
  ownerCode: string | null;
  hasPrerequisites: boolean;
  hasCorequisites: boolean;
  hasAntirequisites: boolean;
  parseStatus: RequirementParseStatus;
};

async function queryCourseRequirementPresence(
  backend: QueryBackend,
  config: AcademicCatalogConfig,
  ownerPid: string,
): Promise<CourseRequirementPresence | null> {
  const rows = await backend.select<QueryRow>(
    `SELECT owner_pid, owner_version_id, owner_code, has_prerequisites,
            has_corequisites, has_antirequisites, parse_status
       FROM course_requirement_presence
      WHERE catalog_id = ?1 AND owner_pid = ?2
      LIMIT 1`,
    [config.catalogId, ownerPid],
  );
  const row = rows[0];
  if (!row) return null;
  const parseStatus = String(row.parse_status);
  return {
    ownerPid: String(row.owner_pid),
    ownerVersionId: String(row.owner_version_id),
    ownerCode: nullableString(row.owner_code),
    hasPrerequisites: toBoolean(row.has_prerequisites),
    hasCorequisites: toBoolean(row.has_corequisites),
    hasAntirequisites: toBoolean(row.has_antirequisites),
    parseStatus:
      parseStatus === "parsed" || parseStatus === "partial"
        ? parseStatus
        : "unparsed",
  };
}

function withMissingCourseRequirementGuards(
  documents: RequirementDocument[],
  presence: CourseRequirementPresence | null,
  config: AcademicCatalogConfig,
): RequirementDocument[] {
  const expectedKinds = presence
    ? [
        presence.hasPrerequisites ? "prerequisite" : null,
        presence.hasCorequisites ? "corequisite" : null,
        presence.hasAntirequisites ? "antirequisite" : null,
      ].filter((kind): kind is string => Boolean(kind))
    : ["prerequisite"];
  const missingKinds = expectedKinds.filter(
    (kind) => !documents.some((document) => document.requirementKind === kind),
  );
  if (
    presence &&
    missingKinds.length === 0 &&
    !(documents.length === 0 && presence.parseStatus !== "parsed")
  ) {
    return documents;
  }

  const guardedKinds = missingKinds.length > 0 ? missingKinds : ["prerequisite"];
  return [
    ...documents,
    ...guardedKinds.map((requirementKind) => ({
      documentId: `missing:${presence?.ownerPid ?? "unknown"}:${requirementKind}`,
      catalogId: config.catalogId,
      ownerType: "courses" as const,
      ownerPid: presence?.ownerPid ?? "unknown",
      ownerVersionId: presence?.ownerVersionId ?? "unknown",
      ownerCode: presence?.ownerCode ?? null,
      requirementKind,
      sourceField: "requirement_presence",
      sourceFormat: "structured_html",
      parseStatus: presence?.parseStatus ?? "unparsed",
      evaluability: "unknown",
      warnings: ["requirement_document_missing_or_incomplete"],
      ast: { schema_version: 1, root: null },
      sourceHtml: null,
      sourceMatchesCurrentPayload: null,
    })),
  ];
}

function programColumns(full = false): string {
  return `SELECT catalog_id, pid, version_id, program_code, title,
                 field_of_study, field_of_study_id, faculty,
                 undergraduate_credential_type, graduate_credential_type,
                 degree, career, date_start, date_end, status${
                   full
                     ? ", description, json_extract(raw_json, '$.planCode') AS plan_code, json_extract(raw_json, '$.programTypeUndergraduate') AS program_type_undergraduate"
                     : ""
                 }`;
}

function mapCourse(row: QueryRow): AcademicCourse {
  return {
    catalogId: String(row.catalog_id),
    pid: String(row.pid),
    versionId: String(row.version_id),
    code: String(row.catalog_course_id),
    courseNumber: nullableString(row.course_number),
    title: String(row.title),
    subjectCode: nullableString(row.subject_code),
    subjectDescription: nullableString(row.subject_description),
    courseLevel: nullableString(row.course_level),
    credits: toNumber(row.credit_value),
    creditMin: toNumber(row.credit_min),
    creditMax: toNumber(row.credit_max),
    dateStart: nullableString(row.date_start),
    dateEnd: nullableString(row.date_end),
    status: nullableString(row.status),
    ...(Object.hasOwn(row, "description")
      ? {
          description: nullableString(row.description),
          notesHtml: nullableString(row.notes_html),
        }
      : {}),
  };
}

function mapProgram(row: QueryRow): AcademicProgram {
  return {
    catalogId: String(row.catalog_id),
    pid: String(row.pid),
    versionId: String(row.version_id),
    code: String(row.program_code),
    title: String(row.title),
    fieldOfStudy: nullableString(row.field_of_study),
    fieldOfStudyId: nullableString(row.field_of_study_id),
    faculty: nullableString(row.faculty),
    undergraduateCredentialType: nullableString(row.undergraduate_credential_type),
    graduateCredentialType: nullableString(row.graduate_credential_type),
    degree: nullableString(row.degree),
    career: nullableString(row.career),
    dateStart: nullableString(row.date_start),
    dateEnd: nullableString(row.date_end),
    status: nullableString(row.status),
    ...(Object.hasOwn(row, "description")
      ? {
          description: nullableString(row.description),
          planCode: nullableString(row.plan_code),
          programTypeUndergraduate: nullableString(row.program_type_undergraduate),
        }
      : {}),
  };
}

function mapRequirementDocument(row: QueryRow): RequirementDocument {
  const ast = parseJson<RequirementAst>(row.ast_json, "requirement AST");
  const warnings = parseJson<unknown>(row.warnings_json, "requirement warnings");
  return {
    documentId: String(row.document_id),
    catalogId: String(row.catalog_id),
    ownerType: String(row.owner_type) as RequirementOwnerType,
    ownerPid: String(row.owner_pid),
    ownerVersionId: String(row.owner_version_id),
    ownerCode: nullableString(row.owner_code),
    requirementKind: String(row.requirement_kind),
    sourceField: String(row.source_field),
    sourceFormat: String(row.source_format),
    parseStatus: String(row.parse_status) as RequirementParseStatus,
    evaluability: String(row.evaluability),
    warnings: Array.isArray(warnings)
      ? warnings.filter((item): item is string => typeof item === "string")
      : [],
    ast,
    sourceHtml: nullableString(row.source_html),
    sourceMatchesCurrentPayload:
      row.source_matches_current_payload == null
        ? null
        : toBoolean(row.source_matches_current_payload),
  };
}

function parseJson<Value>(value: unknown, label: string): Value {
  if (typeof value !== "string") {
    throw new AcademicDataError(`The ${label} is missing or is not text.`);
  }
  try {
    return JSON.parse(value) as Value;
  } catch {
    throw new AcademicDataError(`The ${label} contains invalid JSON.`);
  }
}

function assertReadOnly(sql: string): void {
  if (!/^\s*(?:SELECT|WITH)\b/i.test(sql)) {
    throw new AcademicDataError("Academic calendar queries must be read-only SELECT statements.");
  }
  const withoutStrings = sql.replace(/'(?:''|[^'])*'/g, "''");
  if (/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|VACUUM|ATTACH)\b/i.test(withoutStrings)) {
    throw new AcademicDataError("A mutating academic calendar statement was rejected.");
  }
}

function normalizeLookupCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result || null;
}

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const result = String(value).trim();
  return result || null;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function toInteger(value: unknown): number | null {
  const result = toNumber(value);
  return result == null ? null : Math.trunc(result);
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}
