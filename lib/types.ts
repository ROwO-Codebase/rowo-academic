export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AcademicD1Result<Row> {
  results?: Row[];
  success?: boolean;
  error?: string;
}

export interface AcademicD1PreparedStatement {
  bind(...values: unknown[]): AcademicD1PreparedStatement;
  all<Row = Record<string, unknown>>(): Promise<AcademicD1Result<Row>>;
}

export interface AcademicD1Database {
  prepare(sql: string): AcademicD1PreparedStatement;
}

export interface AcademicEnvironment {
  ACADEMIC_DB?: AcademicD1Database;
  ACADEMIC_DB_ID?: string;
  CF_ACCOUNT_ID?: string;
  CF_D1_API_TOKEN?: string;
  ACADEMIC_CATALOG_ID?: string;
  ACADEMIC_CALENDAR_LABEL?: string;
  ACADEMIC_CALENDAR_YEAR?: string;
}

export interface AcademicCatalogConfig {
  catalogId: string;
  calendarLabel: string;
}

export interface CatalogMetadata {
  catalogId: string;
  calendarLabel: string;
  generatedAt: string | null;
  sources: Array<{
    itemType: "courses" | "programs" | "policies";
    collectionUrl: string;
    lastCrawledAt: string;
    itemCount: number;
    detailCount: number;
    detailsComplete: boolean;
  }>;
}

export interface AcademicCourse {
  catalogId: string;
  pid: string;
  versionId: string;
  code: string;
  courseNumber: string | null;
  title: string;
  subjectCode: string | null;
  subjectDescription: string | null;
  courseLevel: string | null;
  credits: number | null;
  creditMin: number | null;
  creditMax: number | null;
  dateStart: string | null;
  dateEnd: string | null;
  status: string | null;
  description?: string | null;
  notesHtml?: string | null;
}

export interface AcademicProgram {
  catalogId: string;
  pid: string;
  versionId: string;
  code: string;
  title: string;
  fieldOfStudy: string | null;
  fieldOfStudyId: string | null;
  faculty: string | null;
  undergraduateCredentialType: string | null;
  graduateCredentialType: string | null;
  degree: string | null;
  career: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  status: string | null;
  description?: string | null;
  planCode?: string | null;
  programTypeUndergraduate?: string | null;
}

export interface CourseSearchOptions {
  query?: string;
  subjectCode?: string;
  courseLevel?: string;
  limit?: number;
  offset?: number;
}

export interface ProgramSearchOptions {
  query?: string;
  faculty?: string;
  credentialType?: string;
  career?: string;
  limit?: number;
  offset?: number;
}

export type RequirementOwnerType = "courses" | "programs";
export type RequirementParseStatus = "parsed" | "partial" | "unparsed";
export type RequirementEvaluability =
  | "machine"
  | "mixed"
  | "unknown"
  | "direct"
  | "aggregate"
  | "partial"
  | "manual";

export interface RequirementReference {
  ordinal?: number;
  relation?: string;
  target_type?: "course" | "program" | "policy" | "external" | string;
  target_namespace?: string | null;
  target_key?: string | null;
  href?: string | null;
  target_version_id?: string | null;
  target_pid?: string | null;
  target_code?: string | null;
  target_title?: string | null;
  displayed_credits?: string | null;
  credits?: string | number | null;
  source_mode?: "link" | "text" | "derived" | string;
  source?: "link" | "text" | "derived" | string;
  resolution_status?: "resolved" | "unresolved" | "external" | string;
  [key: string]: unknown;
}

export interface RequirementNumericConstraint {
  ordinal?: number;
  constraint_kind?: string;
  metric?: string;
  comparison?: string;
  qualifier?: string;
  value_num?: number | null;
  numeric_value?: number | null;
  value_num_max?: number | null;
  numeric_value_max?: number | null;
  unit?: string | null;
  subject_code?: string | null;
  level_min?: number | null;
  level_max?: number | null;
  scope_text?: string | null;
  context?: string | null;
  raw_text?: string;
  evaluability?: RequirementEvaluability | string;
  parse_status?: RequirementParseStatus | string;
  [key: string]: unknown;
}

export interface RequirementNode {
  node_id?: string;
  ordinal?: number;
  path?: string;
  tree_path?: string;
  node_type: string;
  logic?: string | null;
  operator?: string | null;
  min_count?: number | null;
  max_count?: number | null;
  min_units?: number | null;
  max_units?: number | null;
  min_grade?: number | null;
  min_grade_percent?: number | null;
  text?: string;
  evaluability?: RequirementEvaluability | string;
  parse_status?: RequirementParseStatus | string;
  confidence?: number;
  params?: Record<string, unknown>;
  refs?: RequirementReference[];
  references?: RequirementReference[];
  numeric_constraints?: RequirementNumericConstraint[];
  children?: RequirementNode[];
  [key: string]: unknown;
}

export interface RequirementAst {
  schema_version?: number;
  parser_version?: string;
  document_id?: string;
  owner_type?: RequirementOwnerType;
  owner_pid?: string | null;
  owner_code?: string | null;
  requirement_kind?: string;
  source_field?: string;
  source_sha256?: string;
  parse_status?: RequirementParseStatus;
  warnings?: string[];
  root: RequirementNode | null;
}

export interface RequirementDocument {
  documentId: string;
  catalogId: string;
  ownerType: RequirementOwnerType;
  ownerPid: string;
  ownerVersionId: string;
  ownerCode: string | null;
  requirementKind: string;
  sourceField: string;
  sourceFormat: "structured_html" | "prose_html" | string;
  parseStatus: RequirementParseStatus;
  evaluability: "machine" | "mixed" | "unknown" | string;
  warnings: string[];
  ast: RequirementAst;
  sourceHtml?: string | null;
  sourceMatchesCurrentPayload?: boolean | null;
}

export type TriState = "MET" | "NOT_MET" | "UNKNOWN";

export type StudentCourseStatus =
  | "completed"
  | "in_progress"
  | "enrolled"
  | "planned";

export interface StudentCourseRecord {
  coursePid?: string | null;
  courseCode: string;
  status: StudentCourseStatus;
  gradePercent?: number | null;
  credits?: number | null;
  term?: string | null;
}

export interface StudentProgramRecord {
  programPid?: string | null;
  programCode?: string | null;
  programTitle?: string | null;
  programType?: string | null;
  status?: "active" | "completed" | "planned";
}

export interface RequirementEvaluationContext {
  courses: StudentCourseRecord[];
  programs?: StudentProgramRecord[];
  completedUnits?: number | null;
  totalUnits?: number | null;
}

export interface RequirementEvaluationOptions {
  includePlanned?: boolean;
}

export interface RequirementNodeEvaluation {
  nodeId: string | null;
  nodeType: string;
  text: string | null;
  logic: string | null;
  minCount: number | null;
  maxCount: number | null;
  references: RequirementDisplayReference[];
  state: TriState;
  provisionalState?: TriState;
  reason: string;
  matchedCourseCodes: string[];
  unmetCourseCodes: string[];
  unknownReasons: string[];
  children: RequirementNodeEvaluation[];
}

export interface RequirementDisplayReference {
  ordinal: number | null;
  targetType: string;
  targetPid: string | null;
  targetCode: string | null;
  targetTitle: string | null;
  credits: string | number | null;
  resolutionStatus: string | null;
}

export interface RequirementDocumentEvaluation {
  documentId: string;
  ownerType: RequirementOwnerType;
  ownerPid: string;
  requirementKind: string;
  sourceField: string;
  parseStatus: RequirementParseStatus;
  state: TriState;
  computedState: TriState;
  reason: string;
  root: RequirementNodeEvaluation | null;
  warnings: string[];
}

export interface RequirementEvaluationSummary {
  state: TriState;
  documents: RequirementDocumentEvaluation[];
  metCount: number;
  notMetCount: number;
  unknownCount: number;
}

export interface CourseRecommendation {
  coursePid: string | null;
  courseCode: string;
  title: string | null;
  relation: string;
  requirementKind: string;
  documentId: string;
  sourceField: string;
  isOption: boolean;
  reason: string;
}

export interface CourseEligibilityResult {
  state: TriState;
  eligible: boolean;
  needsReview: boolean;
  documents: RequirementDocumentEvaluation[];
  unmetCourseCodes: string[];
  unknownReasons: string[];
}
