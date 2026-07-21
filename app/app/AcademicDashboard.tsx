"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import {
  countedAcademicUnits,
  isNonAcademicCourseCode,
} from "@/lib/course-records";
import { percentageToGpa, weightedGradeAverage } from "@/lib/grade-scale";
import { isCourseRequirementSection } from "@/lib/requirement-sections";
import { requirementNodeKey } from "@/lib/requirement-overrides";
import {
  buildRequirementAnchorRegistry,
  buildTrackedProgramAnchorRegistry,
  type RequirementAnchorRegistry,
  type TrackedProgramAnchorRegistry,
} from "@/lib/requirement-anchors";
import { Brand } from "../../components/Brand";
import {
  GuestAcademicExplorer,
  SignedInAcademicBrowser as CatalogPanel,
} from "../../components/GuestAcademicExplorer";
import {
  RequirementTree,
  type RequirementOverrideTarget,
  type RequirementTreeNodeData,
} from "../../components/RequirementTree";
import type {
  RequirementNodeManualReference,
  TriState,
} from "@/lib/types";

type TabId = "overview" | "progress" | "planner" | "catalog";
type DashboardDataScope = "overview" | "progress" | "planner";
type CourseStatus = "completed" | "in_progress" | "planned" | "transfer";
type RequirementStatus = "met" | "planned" | "not_met" | "unknown";
type EligibilityStatus = "eligible" | "provisional" | "blocked" | "unknown";

interface DashboardUser {
  id: string;
  username: string;
}

interface ProgramProfile {
  id: string;
  programPid: string;
  programCode: string;
  programTitle: string;
  faculty?: string | null;
  credential?: string | null;
  catalogId: string;
  catalogLabel: string;
}

interface DashboardSummary {
  completedUnits: number | null;
  inProgressUnits: number;
  plannedUnits: number;
  requiredUnits: number | null;
  overallAverage?: number | null;
  majorAverage?: number | null;
  requirementsMet: number | null;
  requirementsTotal: number | null;
  requirementsUnknown: number | null;
}

interface DashboardCourse {
  id: string;
  coursePid: string;
  code: string;
  title: string;
  credits: number;
  nonAcademic: boolean;
  term: string;
  status: CourseStatus;
  grade?: number | null;
  eligibility?: EligibilityStatus;
  eligibilityMessage?: string | null;
  fulfills?: string[];
}

interface DashboardRequirement {
  id: string;
  sourceField: string;
  title: string;
  description?: string | null;
  status: RequirementStatus;
  evidence?: string[];
  missing?: string[];
  note?: string | null;
  sourceLabel?: string | null;
  root?: RequirementTreeNodeData | null;
}

interface DashboardProgramProgress {
  profile: ProgramProfile;
  summary: DashboardSummary | null;
  requirements: DashboardRequirement[];
  calendarMismatch: boolean;
}

interface PlannerTerm {
  id: string;
  label: string;
  sequence: number;
}

interface DashboardSuggestion {
  courseCode: string;
  title: string | null;
  credits: number | null;
  reason: string;
  isOption: boolean;
  planCount: number;
  programs: Array<{
    programCode: string;
    programTitle: string;
  }>;
}

interface DashboardPayload {
  user: DashboardUser;
  profile: ProgramProfile | null;
  catalog?: CatalogSnapshot | null;
  calendarMismatch?: boolean;
  summary: DashboardSummary | null;
  courses: DashboardCourse[];
  requirements: DashboardRequirement[];
  programs: DashboardProgramProgress[];
  terms: PlannerTerm[];
  suggestions: DashboardSuggestion[];
  updatedAt?: string | null;
}

interface CatalogSnapshot {
  id: string;
  label: string;
}

interface CatalogProgram {
  pid: string;
  code: string;
  title: string;
  faculty?: string | null;
  credential?: string | null;
  catalogId: string;
  catalogLabel: string;
}

interface ProgramSearchPayload {
  items?: CatalogProgram[];
  programs?: ApiCatalogProgram[];
  catalog?: CatalogSnapshot | ApiCatalogMetadata;
}

interface CatalogCourse {
  pid: string;
  code: string;
  title: string;
  credits: number;
  description?: string | null;
  eligibility?: EligibilityStatus;
  eligibilityMessage?: string | null;
  prerequisiteSummary?: string | null;
}

interface CourseSearchPayload {
  items?: CatalogCourse[];
  courses?: ApiCatalogCourse[];
}

interface ApiCatalogMetadata {
  catalogId: string;
  calendarLabel: string;
}

interface ApiCatalogProgram {
  catalogId: string;
  pid: string;
  versionId?: string;
  code: string;
  title: string;
  faculty?: string | null;
  undergraduateCredentialType?: string | null;
  graduateCredentialType?: string | null;
  programTypeUndergraduate?: string | null;
  career?: string | null;
}

interface ApiCatalogCourse {
  pid: string;
  versionId?: string;
  code: string;
  title: string;
  credits?: number | null;
  creditMin?: number | null;
  description?: string | null;
}

interface ApiCourseRecord {
  id: string;
  coursePid: string;
  courseCode: string;
  courseTitle: string;
  status: "completed" | "in_progress" | "planned" | "transfer";
  term: string | null;
  grade: string | null;
  credits: number | null;
}

interface ApiRequirementNodeEvaluation extends RequirementTreeNodeData {
  state: "MET" | "NOT_MET" | "UNKNOWN";
  reason: string;
  matchedCourseCodes: string[];
  unmetCourseCodes: string[];
  unknownReasons: string[];
  children: ApiRequirementNodeEvaluation[];
}

interface ApiRequirementDocumentEvaluation {
  documentId: string;
  requirementKind: string;
  sourceField: string;
  parseStatus: string;
  state: "MET" | "NOT_MET" | "UNKNOWN";
  computedState: "MET" | "NOT_MET" | "UNKNOWN";
  plannedCompletion?: boolean;
  reason: string;
  root: ApiRequirementNodeEvaluation | null;
  warnings: string[];
}

interface ApiRequirementAnalysis {
  metCount: number;
  notMetCount: number;
  unknownCount: number;
  documents: ApiRequirementDocumentEvaluation[];
}

interface ApiSavedProgram {
  id: string;
  catalogId?: string;
  programPid?: string;
  programCode: string;
  programName: string;
  programType?: string | null;
  calendarYear: number;
}

interface ApiProgramProgress {
  saved: ApiSavedProgram | null;
  catalog: ApiCatalogProgram | null;
  calendarMismatch: boolean;
  requirementAnalysis: ApiRequirementAnalysis | null;
}

interface ApiDashboardPayload {
  dataScope?: DashboardDataScope;
  user: DashboardUser;
  program: {
    selected: ApiSavedProgram | null;
    catalog: ApiCatalogProgram | null;
    calendarMismatch?: boolean;
  };
  programs?: ApiProgramProgress[];
  courseRecords: ApiCourseRecord[];
  calendar: ApiCatalogMetadata;
  requirementAnalysis: ApiRequirementAnalysis | null;
  recommendedUnmetCourseReferences?: Array<{
    courseCode: string;
    reason: string;
    isOption: boolean;
    planCount?: number;
    programs?: Array<{
      programCode: string;
      programName: string;
    }>;
    course: ApiCatalogCourse | null;
  }>;
  progress: {
    completedUnits: number | null;
    totalRecordedCredits: number;
  };
}

interface ApiCourseMutationPayload {
  success: boolean;
  eligibility?: {
    state: "MET" | "NOT_MET" | "UNKNOWN";
    eligible: boolean;
    needsReview: boolean;
    unmetCourseCodes: string[];
    unknownReasons: string[];
  } | null;
}

interface RequirementOverrideEditorTarget extends RequirementOverrideTarget {
  programId: string;
  documentId: string;
  requirementTitle: string;
}

interface RequirementOverrideSaveInput {
  state: TriState | null;
  note: string | null;
  references: Array<{
    targetType: "course" | "program";
    targetPid: string;
  }>;
}

interface ApiPlannerEligibilityResult {
  courseId: string;
  courseCode: string;
  term: string | null;
  state: "MET" | "NOT_MET" | "UNKNOWN";
  eligible: boolean;
  needsReview: boolean;
  reliesOnPlanned: boolean;
  unmetCourseCodes: string[];
  unknownReasons: string[];
}

interface ApiPlannerEligibilityPayload {
  success: boolean;
  results: ApiPlannerEligibilityResult[];
}

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "progress", label: "Progress" },
  { id: "planner", label: "Planner" },
  { id: "catalog", label: "Browse" },
];

const courseStatusLabels: Record<CourseStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  planned: "Planned",
  transfer: "Transfer",
};

const requirementMeta: Record<
  RequirementStatus,
  { label: string; symbol: string }
> = {
  met: { label: "Requirement met", symbol: "✓" },
  planned: { label: "On track with plan", symbol: "↗" },
  not_met: { label: "Not met", symbol: "!" },
  unknown: { label: "Needs review", symbol: "?" },
};

const eligibilityMeta: Record<
  EligibilityStatus,
  { label: string; symbol: string }
> = {
  eligible: { label: "Eligible", symbol: "✓" },
  provisional: { label: "Eligible with plan", symbol: "↗" },
  blocked: { label: "Not yet eligible", symbol: "!" },
  unknown: { label: "Needs review", symbol: "?" },
};

async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  let data: unknown = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const directMessage =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
        ? data.message
        : null;
    const nestedError =
      data &&
      typeof data === "object" &&
      "error" in data &&
      data.error &&
      typeof data.error === "object" &&
      "message" in data.error &&
      typeof data.error.message === "string"
        ? data.error.message
        : null;
    const stringError =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : null;
    const message =
      directMessage ||
      nestedError ||
      stringError ||
      "The request could not be completed.";
    throw new ApiError(response.status, message);
  }

  return data as T;
}

function formatUnits(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function formatAverage(value?: number | null): string {
  return typeof value === "number" ? value.toFixed(1) + "%" : "Needs grades";
}

function formatGpa(value?: number | null): string | null {
  if (typeof value !== "number") return null;
  const gpa = percentageToGpa(value);
  return gpa === null ? "GPA not mapped" : gpa.toFixed(2) + " GPA";
}

function formatAverageWithGpa(value?: number | null): string {
  const percentage = formatAverage(value);
  const gpa = formatGpa(value);
  return gpa ? percentage + " · " + gpa : percentage;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function mapTriState(
  state: "MET" | "NOT_MET" | "UNKNOWN" | null | undefined,
): RequirementStatus {
  if (state === "MET") return "met";
  if (state === "NOT_MET") return "not_met";
  return "unknown";
}

function readableRequirementName(value: string): string {
  const spaced = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced
    ? spaced.charAt(0).toUpperCase() + spaced.slice(1)
    : "Program requirement";
}

function numericGrade(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function weightedAverage(records: ApiCourseRecord[]): number | null {
  const graded = records
    .filter(
      (record) =>
        (record.status === "completed" || record.status === "transfer") &&
        !isNonAcademicCourseCode(record.courseCode),
    )
    .map((record) => ({
      grade: numericGrade(record.grade),
      credits: record.credits ?? 0,
    }))
    .filter(
      (record): record is { grade: number; credits: number } =>
        record.grade !== null && record.credits > 0,
    );
  const units = graded.reduce((sum, record) => sum + record.credits, 0);
  if (units === 0) return null;
  return (
    graded.reduce(
      (sum, record) => sum + record.grade * record.credits,
      0,
    ) / units
  );
}

function termSequence(label: string): number {
  const match = label.match(/^(\d{4})-(Winter|Spring|Fall)$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const season = { Winter: 1, Spring: 2, Fall: 3 }[
    match[2] as "Winter" | "Spring" | "Fall"
  ];
  return Number(match[1]) * 10 + season;
}

function courseRecordTermSequence(label: string): number {
  if (label === "Unscheduled") return -1;
  const sequence = termSequence(label);
  return sequence === Number.MAX_SAFE_INTEGER ? 0 : sequence;
}

function normalizeRequirements(
  analysis: ApiRequirementAnalysis | null | undefined,
): DashboardRequirement[] {
  return (analysis?.documents || []).map((document) => {
    const matched = document.root?.matchedCourseCodes || [];
    const unmet = document.root?.unmetCourseCodes || [];
    const unknownReasons = document.root?.unknownReasons || [];
    return {
      id: document.documentId,
      sourceField: document.sourceField,
      title: readableRequirementName(
        document.requirementKind || document.sourceField,
      ),
      description: document.reason,
      status: document.plannedCompletion
        ? "planned"
        : mapTriState(document.state),
      evidence: matched,
      missing: unmet,
      note: unknownReasons[0] || document.warnings[0] || null,
      sourceLabel: [
        readableRequirementName(document.sourceField),
        isCourseRequirementSection(document.requirementKind)
          ? document.parseStatus
          : null,
      ].filter(Boolean).join(" · "),
      root: document.root,
    };
  });
}

function normalizeProgramProfile(
  saved: ApiSavedProgram,
  catalogProgram: ApiCatalogProgram | null,
  calendar: ApiCatalogMetadata,
  calendarMismatch: boolean,
): ProgramProfile {
  return {
    id: saved.id,
    programPid: catalogProgram?.pid || saved.programPid || saved.programCode,
    programCode: saved.programCode,
    programTitle: saved.programName,
    faculty: catalogProgram?.faculty || null,
    credential:
      catalogProgram?.undergraduateCredentialType ||
      catalogProgram?.graduateCredentialType ||
      saved.programType ||
      null,
    catalogId: saved.catalogId || calendar.catalogId,
    catalogLabel: calendarMismatch
      ? String(saved.calendarYear) + " calendar"
      : calendar.calendarLabel,
  };
}

function normalizeDashboardPayload(
  payload: DashboardPayload | ApiDashboardPayload,
): DashboardPayload {
  if ("profile" in payload) {
    return {
      ...payload,
      calendarMismatch: payload.calendarMismatch === true,
      courses: Array.isArray(payload.courses) ? payload.courses : [],
      requirements: Array.isArray(payload.requirements)
        ? payload.requirements
        : [],
      programs: Array.isArray(payload.programs)
        ? payload.programs
        : payload.profile && payload.summary
          ? [
              {
                profile: payload.profile,
                summary: payload.summary,
                requirements: Array.isArray(payload.requirements)
                  ? payload.requirements
                  : [],
                calendarMismatch: payload.calendarMismatch === true,
              },
            ]
          : [],
      terms: Array.isArray(payload.terms) ? payload.terms : [],
      suggestions: Array.isArray(payload.suggestions)
        ? payload.suggestions
        : [],
    };
  }

  const records = Array.isArray(payload.courseRecords)
    ? payload.courseRecords
    : [];
  const analysis = payload.requirementAnalysis;
  const requirements = normalizeRequirements(analysis);

  const dashboardCourses: DashboardCourse[] = records.map((record) => {
    const mappedStatus: CourseStatus = record.status;
    return {
      id: record.id,
      coursePid: record.coursePid,
      code: record.courseCode,
      title: record.courseTitle,
      credits: record.credits ?? 0,
      nonAcademic: isNonAcademicCourseCode(record.courseCode),
      term: record.term || "Unscheduled",
      status: mappedStatus,
      grade: numericGrade(record.grade),
      eligibility: mappedStatus === "planned" ? "unknown" : undefined,
      eligibilityMessage:
        mappedStatus === "planned"
          ? "Use Check eligibility to evaluate this course against earlier terms."
          : null,
    };
  });

  const plannedTerms = Array.from(
    new Set(
      records
        .filter((record) => record.status === "planned" && record.term)
        .map((record) => record.term as string),
    ),
  )
    .sort((left, right) => termSequence(left) - termSequence(right))
    .map((label, index) => ({
      id: "term-" + label,
      label,
      sequence: index,
    }));

  const completedUnits = payload.progress?.completedUnits ?? null;
  const inProgressUnits = records
    .filter((record) => record.status === "in_progress")
    .reduce(
      (sum, record) =>
        sum + countedAcademicUnits(record.courseCode, record.credits),
      0,
    );
  const plannedUnits = records
    .filter((record) => record.status === "planned")
    .reduce(
      (sum, record) =>
        sum + countedAcademicUnits(record.courseCode, record.credits),
      0,
    );
  const selected = payload.program?.selected;
  const catalogProgram = payload.program?.catalog;
  const calendar = payload.calendar;
  const calendarMismatch = payload.program?.calendarMismatch === true;
  const apiPrograms =
    payload.programs && payload.programs.length > 0
      ? payload.programs
      : selected
        ? [
            {
              saved: selected,
              catalog: catalogProgram,
              calendarMismatch,
              requirementAnalysis: analysis,
            },
          ]
        : [];
  const programs: DashboardProgramProgress[] = apiPrograms.flatMap((program) => {
    if (!program.saved) return [];
    const programRequirements = normalizeRequirements(program.requirementAnalysis);
    return [
      {
        profile: normalizeProgramProfile(
          program.saved,
          program.catalog,
          calendar,
          program.calendarMismatch,
        ),
        summary: program.calendarMismatch
          ? null
          : {
              completedUnits,
              inProgressUnits,
              plannedUnits,
              requiredUnits: null,
              overallAverage: weightedAverage(records),
              majorAverage: null,
              requirementsMet: program.requirementAnalysis?.metCount ?? null,
              requirementsTotal:
                program.requirementAnalysis?.documents.length ?? null,
              requirementsUnknown:
                program.requirementAnalysis?.unknownCount ?? null,
            },
        requirements: programRequirements,
        calendarMismatch: program.calendarMismatch,
      },
    ];
  });
  const suggestionMap = new Map<string, DashboardSuggestion>();
  for (const reference of payload.recommendedUnmetCourseReferences || []) {
    if (!reference.courseCode || suggestionMap.has(reference.courseCode)) continue;
    const suggestionPrograms =
      reference.programs?.map((program) => ({
        programCode: program.programCode,
        programTitle: program.programName,
      })) ||
      (selected
        ? [
            {
              programCode: selected.programCode,
              programTitle: selected.programName,
            },
          ]
        : []);
    suggestionMap.set(reference.courseCode, {
      courseCode: reference.courseCode,
      title: reference.course?.title || null,
      credits:
        reference.course?.credits ?? reference.course?.creditMin ?? null,
      reason: reference.reason,
      isOption: reference.isOption,
      planCount: reference.planCount ?? Math.max(1, suggestionPrograms.length),
      programs: suggestionPrograms,
    });
  }

  return {
    user: payload.user,
    profile: selected
      ? normalizeProgramProfile(selected, catalogProgram, calendar, calendarMismatch)
      : null,
    catalog: {
      id: calendar.catalogId,
      label: calendar.calendarLabel,
    },
    calendarMismatch,
    summary: selected && !calendarMismatch
      ? {
          completedUnits,
          inProgressUnits,
          plannedUnits,
          requiredUnits: null,
          overallAverage: weightedAverage(records),
          majorAverage: null,
          requirementsMet: analysis?.metCount ?? null,
          requirementsTotal: analysis?.documents.length ?? null,
          requirementsUnknown: analysis?.unknownCount ?? null,
        }
      : null,
    courses: dashboardCourses,
    requirements,
    programs,
    terms: plannedTerms,
    suggestions: Array.from(suggestionMap.values()).sort(
      (left, right) =>
        right.planCount - left.planCount ||
        left.courseCode.localeCompare(right.courseCode),
    ),
  };
}

function mergeDashboardScope(
  current: DashboardPayload | null,
  incoming: DashboardPayload,
  scope: DashboardDataScope,
): DashboardPayload {
  if (!current || scope === "overview") return incoming;
  if (scope === "progress") {
    return {
      ...incoming,
      suggestions: current.suggestions,
    };
  }

  const summary = incoming.summary && current.summary
    ? {
        ...incoming.summary,
        requirementsMet: current.summary.requirementsMet,
        requirementsTotal: current.summary.requirementsTotal,
        requirementsUnknown: current.summary.requirementsUnknown,
      }
    : incoming.summary;
  return {
    ...incoming,
    summary,
    requirements: current.requirements,
    programs: current.programs,
  };
}

function DashboardTabs({
  activeTab,
  onChange,
  className,
}: {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
  className: string;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (
      event.key !== "ArrowRight" &&
      event.key !== "ArrowLeft" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    onChange(tabs[nextIndex].id);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        "[role='tab']",
      );
    buttons?.[nextIndex]?.focus();
  }

  return (
    <nav className={className} aria-label="Academic workspace">
      <div className="dashboard-tabs" role="tablist" aria-label="Academic views">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={classNames(
              "dashboard-tab",
              activeTab === tab.id && "active",
            )}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function DashboardHeader({
  activeTab,
  onTabChange,
  user,
  showTabs,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  user?: DashboardUser;
  showTabs: boolean;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function signOut() {
    setSigningOut(true);
    setLogoutError("");
    try {
      const payload = await requestJson<{ redirectTo?: string }>(
        "/api/auth/logout?returnTo=%2F",
        { method: "POST" },
      );
      window.location.assign(payload.redirectTo || "/");
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Sign out could not be completed.",
      );
      setSigningOut(false);
    }
  }

  return (
    <header className="site-header dashboard-header">
      <div className="site-header-inner">
        <Brand href="/app" />
        {showTabs && (
          <DashboardTabs
            activeTab={activeTab}
            onChange={onTabChange}
            className="desktop-dashboard-nav"
          />
        )}
        <details className="account-menu">
          <summary>
            <span className="account-avatar" aria-hidden="true">
              {user?.username?.slice(0, 1).toUpperCase() || "R"}
            </span>
            <span className="account-name">{user?.username || "ROwO account"}</span>
            <span aria-hidden="true">⌄</span>
          </summary>
          <div className="account-popover">
            <span className="account-popover-label">Signed in with ROwO</span>
            <strong>{user?.username || "Account"}</strong>
            <a href="https://rowo.link">Back to ROwO</a>
            <button type="button" disabled={signingOut} onClick={() => void signOut()}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
            {logoutError && <small role="alert">{logoutError}</small>}
          </div>
        </details>
      </div>
    </header>
  );
}

function AppLoading() {
  return (
    <div className="app-state shell" role="status" aria-live="polite">
      <div className="loading-heading">
        <div className="skeleton skeleton-kicker" />
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-copy" />
      </div>
      <div className="loading-grid">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <span className="sr-only">Loading your academic plan</span>
    </div>
  );
}

function DeferredTabLoading({ label }: { label: string }) {
  return (
    <div className="dashboard-panel">
      <div className="inline-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        Loading {label.toLowerCase()} data…
      </div>
    </div>
  );
}

function DeferredTabError({
  label,
  message,
  onRetry,
}: {
  label: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="dashboard-panel">
      <div className="inline-error" role="alert">
        <strong>{label} data did not load.</strong>
        <span>{message}</span>
        <button type="button" onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}

function AppError({
  title,
  message,
  onRetry,
  unauthorized = false,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  unauthorized?: boolean;
}) {
  return (
    <div className="center-state shell">
      <span className="state-symbol" aria-hidden="true">
        {unauthorized ? "↗" : "!"}
      </span>
      <h1>{title}</h1>
      <p>{message}</p>
      <div className="state-actions">
        {unauthorized ? (
          <a
            className="button button-primary"
            href="/auth/login?return_to=%2Fapp"
          >
            Sign in with ROwO
          </a>
        ) : (
          onRetry && (
            <button className="button button-primary" type="button" onClick={onRetry}>
              Try again
            </button>
          )
        )}
        <Link className="button button-secondary" href="/">
          Return home
        </Link>
      </div>
    </div>
  );
}

function ProgramOnboarding({
  user,
  activeCatalog,
  calendarMismatch,
  onComplete,
}: {
  user: DashboardUser;
  activeCatalog?: CatalogSnapshot | null;
  calendarMismatch?: {
    programTitle: string;
    savedCalendarLabel: string;
    activeCalendarLabel: string;
  } | null;
  onComplete: () => Promise<void>;
}) {
  const searchId = useId();
  const [query, setQuery] = useState(
    calendarMismatch?.programTitle || "",
  );
  const [results, setResults] = useState<CatalogProgram[]>([]);
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [state, setState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [savingPid, setSavingPid] = useState<string | null>(null);

  const searchPrograms = useCallback(async (searchQuery: string) => {
    const cleanQuery = searchQuery.trim();
    if (cleanQuery.length < 2) {
      setResults([]);
      setState("idle");
      return;
    }

    setState("loading");
    setError("");
    try {
      const payload = await requestJson<ProgramSearchPayload>(
        "/api/catalog/programs?q=" +
          encodeURIComponent(cleanQuery) +
          "&limit=10",
      );
      const normalizedPrograms = payload.items
        ? payload.items
        : (payload.programs || []).map((program) => ({
            pid: program.pid,
            code: program.code,
            title: program.title,
            faculty: program.faculty || null,
            credential:
              program.undergraduateCredentialType ||
              program.graduateCredentialType ||
              program.programTypeUndergraduate ||
              program.career ||
              null,
            catalogId: program.catalogId,
            catalogLabel:
              "calendarLabel" in (payload.catalog || {})
                ? (payload.catalog as ApiCatalogMetadata).calendarLabel
                : activeCatalog?.label || "Active calendar",
          }));
      setResults(normalizedPrograms);
      if (payload.catalog) {
        setCatalog(
          "calendarLabel" in payload.catalog
            ? {
                id: payload.catalog.catalogId,
                label: payload.catalog.calendarLabel,
              }
            : payload.catalog,
        );
      } else {
        setCatalog(activeCatalog || null);
      }
      setState("ready");
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Programs could not be loaded.",
      );
      setState("error");
    }
  }, [activeCatalog]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void searchPrograms(query);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, searchPrograms]);

  async function chooseProgram(program: CatalogProgram) {
    setSavingPid(program.pid);
    setError("");
    try {
      await requestJson<{ ok: true }>("/api/profile/program", {
        method: "POST",
        body: JSON.stringify({
          programCode: program.code,
        }),
      });
      await onComplete();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Your program could not be saved.",
      );
      setSavingPid(null);
    }
  }

  return (
    <main id="main-content" className="onboarding-shell shell">
      {calendarMismatch && (
        <section className="calendar-mismatch-notice" role="alert">
          <span className="calendar-mismatch-symbol" aria-hidden="true">!</span>
          <div>
            <span className="card-kicker">Calendar update required</span>
            <h1>Reconfirm your program before using this evaluation.</h1>
            <p>
              Your saved selection for {calendarMismatch.programTitle} belongs
              to the {calendarMismatch.savedCalendarLabel}. ROwO Academic is now
              using the {calendarMismatch.activeCalendarLabel}, so progress and
              suggestions are paused until you select the matching active
              program record.
            </p>
          </div>
          <a className="button button-primary" href="#program-picker-title">
            Reselect program
            <span aria-hidden="true">↓</span>
          </a>
        </section>
      )}
      <div className="onboarding-copy">
        <span className="eyebrow compact">
          {calendarMismatch ? "Evaluation paused" : "Welcome, " + user.username}
        </span>
        <h1>
          {calendarMismatch
            ? "Match your program to the active calendar."
            : "Start with the program you are following."}
        </h1>
        <p>
          {calendarMismatch
            ? "Search the active calendar and choose your program again. Course records remain saved; only the program snapshot is being reconfirmed."
            : "Choose the matching Waterloo calendar record. Your selection keeps its catalog snapshot so future calendar updates do not silently change today’s result."}
        </p>
        <div className="onboarding-assurance">
          <span className="status-dot met" aria-hidden="true">✓</span>
          <div>
            <strong>Your academic data stays in ROwO Academic.</strong>
            <small>
              It is not written to the public calendar database or your ROwO
              account database.
            </small>
          </div>
        </div>
      </div>

      <section className="program-picker" aria-labelledby="program-picker-title">
        <div className="picker-step">
          {calendarMismatch ? "Required update" : "Step 1 of 2"}
        </div>
        <h2 id="program-picker-title">
          {calendarMismatch ? "Reselect from the active calendar" : "Find your program"}
        </h2>
        <p>
          Search by title or code
          {calendarMismatch ? " and confirm the closest active match." : ". You can add options and minors later."}
        </p>
        <label htmlFor={searchId}>Program name</label>
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            id={searchId}
            type="search"
            role="combobox"
            aria-expanded={state === "ready" && results.length > 0}
            aria-controls={searchId + "-results"}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try Computer Science or H-Computer Science"
          />
        </div>

        {catalog && (
          <div className="catalog-context">
            <span>Calendar snapshot</span>
            <strong>{catalog.label}</strong>
          </div>
        )}

        <div className="picker-results" id={searchId + "-results"}>
          {state === "idle" && (
            <div className="inline-empty">
              Enter at least two characters to search the active academic
              calendar.
            </div>
          )}
          {state === "loading" && (
            <div className="inline-loading" role="status">
              <span className="spinner" aria-hidden="true" />
              Searching programs…
            </div>
          )}
          {state === "error" && (
            <div className="inline-error" role="alert">
              <strong>Program search is unavailable.</strong>
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void searchPrograms(query)}
              >
                Retry
              </button>
            </div>
          )}
          {state === "ready" && results.length === 0 && (
            <div className="inline-empty">
              No active program matched “{query.trim()}”. Try a broader title.
            </div>
          )}
          {state === "ready" && results.length > 0 && (
            <div className="program-results" role="listbox" aria-label="Programs">
              {results.map((program) => (
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="program-result"
                  key={program.pid}
                  disabled={savingPid !== null}
                  onClick={() => void chooseProgram(program)}
                >
                  <div>
                    <strong>{program.title}</strong>
                    <span>
                      {[program.credential, program.faculty]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <small>{program.code}</small>
                  </div>
                  <span className="choose-program">
                    {savingPid === program.pid ? "Saving…" : "Choose"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {error && state !== "error" && (
          <p className="form-error" role="alert">{error}</p>
        )}
      </section>
    </main>
  );
}

function SummaryMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function EligibilityBadge({
  status = "unknown",
}: {
  status?: EligibilityStatus;
}) {
  const meta = eligibilityMeta[status];
  return (
    <span className={"eligibility-badge eligibility-" + status}>
      <span aria-hidden="true">{meta.symbol}</span>
      {meta.label}
    </span>
  );
}

function CourseStatusBadge({ status }: { status: CourseStatus }) {
  return (
    <span className={"status-badge course-" + status}>
      {courseStatusLabels[status]}
    </span>
  );
}

function EditCourseDialog({
  course,
  termOptions,
  saving,
  onClose,
  onSave,
}: {
  course: DashboardCourse;
  termOptions: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (patch: {
    status: CourseStatus;
    term: string | null;
    grade: number | null;
  }) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const termListId = useId();
  const [status, setStatus] = useState<CourseStatus>(course.status);
  const [term, setTerm] = useState(
    course.term === "Unscheduled" ? "" : course.term,
  );
  const [grade, setGrade] = useState(
    typeof course.grade === "number" ? String(course.grade) : "",
  );
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTerm = term.trim();
    if ((status === "planned" || status === "in_progress") && !cleanTerm) {
      setFormError("Enter the term for this planned or in-progress course.");
      return;
    }
    const numericGrade = grade.trim() === "" ? null : Number(grade);
    if (
      numericGrade !== null &&
      (!Number.isFinite(numericGrade) || numericGrade < 0 || numericGrade > 100)
    ) {
      setFormError("Grade must be between 0 and 100.");
      return;
    }

    setFormError("");
    try {
      await onSave({
        status,
        term: cleanTerm || null,
        grade:
          status === "completed" || status === "transfer"
            ? numericGrade
            : null,
      });
      onClose();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "The course could not be updated.",
      );
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="course-edit-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <form className="course-edit-form" onSubmit={saveCourse}>
        <div className="course-edit-header">
          <div>
            <span>Edit course record</span>
            <h2 id={titleId}>{course.code} · {course.title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close edit course dialog"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="course-edit-body">
          <div className="form-grid">
            <label>
              Status
              <select
                value={status}
                onChange={(event) => {
                  const nextStatus = event.target.value as CourseStatus;
                  setStatus(nextStatus);
                  if (nextStatus === "planned" || nextStatus === "in_progress") {
                    setGrade("");
                  }
                }}
              >
                <option value="completed">Completed</option>
                <option value="in_progress">In progress</option>
                <option value="planned">Planned</option>
                <option value="transfer">Transfer</option>
              </select>
            </label>
            <label>
              Term
              <input
                type="text"
                list={termListId}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="2026-Fall"
                autoComplete="off"
              />
              <datalist id={termListId}>
                {termOptions.map((option) => (
                  <option value={option} key={option} />
                ))}
              </datalist>
            </label>
            <label>
              Grade <span>(optional)</span>
              <div className="grade-field">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  value={grade}
                  onChange={(event) => setGrade(event.target.value)}
                  disabled={status !== "completed" && status !== "transfer"}
                />
                <span aria-hidden="true">%</span>
              </div>
            </label>
          </div>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="form-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

interface OverrideReferenceCandidate {
  targetType: "course" | "program";
  targetPid: string;
  targetVersionId: string;
  targetCode: string;
  targetTitle: string;
  credits: number | null;
}

const overrideStateLabels: Record<TriState, string> = {
  MET: "Satisfied",
  NOT_MET: "Unsatisfied",
  UNKNOWN: "Uncertain",
};

function overrideNodeLabel(node: RequirementTreeNodeData): string {
  if (node.text?.trim()) return node.text.trim().replace(/:\s*$/, "");
  return node.nodeType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function RequirementOverrideDialog({
  target,
  saving,
  onClose,
  onSave,
  onRevert,
}: {
  target: RequirementOverrideEditorTarget;
  saving: boolean;
  onClose: () => void;
  onSave: (input: RequirementOverrideSaveInput) => Promise<void>;
  onRevert: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const existing = target.node.manualOverride;
  const [state, setState] = useState<TriState | "AUTO">(
    existing?.state ?? "AUTO",
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const [references, setReferences] = useState<
    RequirementNodeManualReference[]
  >(existing?.references ?? []);
  const [referenceType, setReferenceType] = useState<"course" | "program">(
    "course",
  );
  const [referenceQuery, setReferenceQuery] = useState("");
  const [referenceResults, setReferenceResults] = useState<
    OverrideReferenceCandidate[]
  >([]);
  const [referenceSearchState, setReferenceSearchState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const query = referenceQuery.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        if (referenceType === "course") {
          const payload = await requestJson<CourseSearchPayload>(
            "/api/catalog/courses?q=" + encodeURIComponent(query) + "&limit=8",
            { signal: controller.signal },
          );
          const courses = payload.courses ?? payload.items ?? [];
          setReferenceResults(courses.map((course) => ({
            targetType: "course",
            targetPid: course.pid,
            targetVersionId: "versionId" in course
              ? course.versionId ?? ""
              : "",
            targetCode: course.code,
            targetTitle: course.title,
            credits: course.credits ??
              ("creditMin" in course ? course.creditMin ?? null : null),
          })));
        } else {
          const payload = await requestJson<ProgramSearchPayload>(
            "/api/catalog/programs?q=" + encodeURIComponent(query) + "&limit=8",
            { signal: controller.signal },
          );
          const programs = payload.programs ?? payload.items ?? [];
          setReferenceResults(programs.map((program) => ({
            targetType: "program",
            targetPid: program.pid,
            targetVersionId: "versionId" in program
              ? program.versionId ?? ""
              : "",
            targetCode: program.code,
            targetTitle: program.title,
            credits: null,
          })));
        }
        setReferenceSearchState("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setReferenceResults([]);
        setReferenceSearchState("error");
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [referenceQuery, referenceType]);

  function addReference(candidate: OverrideReferenceCandidate) {
    if (
      references.some(
        (reference) =>
          reference.targetType === candidate.targetType &&
          reference.targetPid === candidate.targetPid,
      )
    ) {
      setFormError("That reference is already attached to this node.");
      return;
    }
    setReferences((current) => [
      ...current,
      {
        id: "pending:" + candidate.targetType + ":" + candidate.targetPid,
        ...candidate,
        resolutionStatus: "resolved",
      },
    ]);
    setReferenceQuery("");
    setReferenceResults([]);
    setReferenceSearchState("idle");
    setFormError("");
  }

  async function saveOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanNote = note.trim();
    if (state === "AUTO" && !cleanNote && references.length === 0) {
      if (existing) {
        setFormError("");
        try {
          await onRevert();
        } catch (error) {
          setFormError(
            error instanceof Error
              ? error.message
              : "The override could not be reverted.",
          );
        }
        return;
      }
      setFormError(
        "Choose a manual status, add a reference, or enter a note before saving.",
      );
      return;
    }
    setFormError("");
    try {
      await onSave({
        state: state === "AUTO" ? null : state,
        note: cleanNote || null,
        references: references.map((reference) => ({
          targetType: reference.targetType,
          targetPid: reference.targetPid,
        })),
      });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "The override could not be saved.",
      );
    }
  }

  async function revertOverride() {
    if (!existing) return;
    if (!window.confirm("Revert this manual edit and restore automatic evaluation?")) {
      return;
    }
    setFormError("");
    try {
      await onRevert();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "The override could not be reverted.",
      );
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="requirement-override-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <form className="requirement-override-form" onSubmit={saveOverride}>
        <div className="course-edit-header">
          <div>
            <span>Manual requirement edit</span>
            <h2 id={titleId}>{overrideNodeLabel(target.node)}</h2>
            <small>{target.requirementTitle}</small>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close override dialog"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="requirement-override-body">
          <section className="override-section" aria-labelledby={titleId + "-status"}>
            <div className="override-section-heading">
              <div>
                <h3 id={titleId + "-status"}>Status</h3>
                <p>
                  Automatic result: {overrideStateLabels[
                    target.node.automaticState ?? target.node.state ?? "UNKNOWN"
                  ]}
                </p>
              </div>
            </div>
            <div className="override-status-options">
              {([
                ["AUTO", "Automatic", "Follow course and child-node evidence"],
                ["MET", "Satisfied", "Count this node as complete"],
                ["NOT_MET", "Unsatisfied", "Count this node as incomplete"],
                ["UNKNOWN", "Uncertain", "Keep this node in needs review"],
              ] as const).map(([value, label, description]) => (
                <label key={value} className={state === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="override-state"
                    value={value}
                    checked={state === value}
                    disabled={saving}
                    onChange={() => setState(value)}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="override-section" aria-labelledby={titleId + "-references"}>
            <div className="override-section-heading">
              <div>
                <h3 id={titleId + "-references"}>Course or plan references</h3>
                <p>References document the edit; only the status changes progress.</p>
              </div>
            </div>
            {references.length > 0 && (
              <ul className="override-reference-selection">
                {references.map((reference) => (
                  <li key={reference.targetType + ":" + reference.targetPid}>
                    <span>
                      <strong>{reference.targetCode}</strong>
                      {" · " + reference.targetTitle}
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setReferences((current) =>
                        current.filter((item) => item !== reference))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="override-reference-search">
              <select
                aria-label="Reference type"
                value={referenceType}
                disabled={saving}
                onChange={(event) => {
                  setReferenceType(event.target.value as "course" | "program");
                  setReferenceResults([]);
                  setReferenceSearchState(
                    referenceQuery.trim().length >= 2 ? "loading" : "idle",
                  );
                }}
              >
                <option value="course">Course</option>
                <option value="program">Plan</option>
              </select>
              <input
                type="search"
                value={referenceQuery}
                disabled={saving}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  setReferenceQuery(nextQuery);
                  setReferenceResults([]);
                  setReferenceSearchState(
                    nextQuery.trim().length >= 2 ? "loading" : "idle",
                  );
                }}
                placeholder={referenceType === "course"
                  ? "Search CS 246 or algorithms"
                  : "Search a plan"}
                aria-label={referenceType === "course"
                  ? "Search course references"
                  : "Search plan references"}
              />
              {referenceSearchState === "loading" && (
                <span className="spinner" aria-label="Searching" />
              )}
            </div>
            {referenceSearchState === "error" && (
              <p className="form-error">References could not be searched.</p>
            )}
            {referenceSearchState === "ready" && (
              <div
                className="override-reference-results"
                aria-live="polite"
              >
                {referenceResults.length === 0 ? (
                  <p>No matching references.</p>
                ) : referenceResults.map((candidate) => (
                  <button
                    type="button"
                    disabled={saving}
                    key={candidate.targetType + ":" + candidate.targetPid}
                    onClick={() => addReference(candidate)}
                  >
                    <strong>{candidate.targetCode}</strong>
                    <span>{candidate.targetTitle}</span>
                    <small>Add</small>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="override-section" aria-labelledby={titleId + "-note"}>
            <div className="override-section-heading">
              <div>
                <h3 id={titleId + "-note"}>Note</h3>
                <p>Add context for yourself or an academic-advisor review.</p>
              </div>
              {note && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setNote("")}
                >
                  Remove note
                </button>
              )}
            </div>
            <textarea
              value={note}
              maxLength={4000}
              rows={4}
              aria-labelledby={titleId + "-note"}
              disabled={saving}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why are you overriding or annotating this requirement?"
            />
          </section>

          {formError && <p className="form-error" role="alert">{formError}</p>}
          <div className="form-actions override-form-actions">
            {existing && (
              <button
                className="button button-danger-outline"
                type="button"
                disabled={saving}
                onClick={() => void revertOverride()}
              >
                Revert manual edit
              </button>
            )}
            <span />
            <button
              className="button button-secondary"
              type="button"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save manual edit"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

function OverviewPanel({
  dashboard,
  onOpenCatalog,
  onReload,
  busyCourseId,
  setBusyCourseId,
  setNotice,
}: {
  dashboard: DashboardPayload;
  onOpenCatalog: () => void;
  onReload: () => Promise<void>;
  busyCourseId: string | null;
  setBusyCourseId: (id: string | null) => void;
  setNotice: (message: string) => void;
}) {
  const [editingCourse, setEditingCourse] = useState<DashboardCourse | null>(null);
  const summary = dashboard.summary;
  const completedPercent =
    summary &&
    summary.completedUnits !== null &&
    summary.requiredUnits &&
    summary.requiredUnits > 0
      ? Math.min(100, (summary.completedUnits / summary.requiredUnits) * 100)
      : 0;
  const projectedUnits = summary
    ? summary.completedUnits === null
      ? null
      : summary.completedUnits + summary.inProgressUnits + summary.plannedUnits
    : null;
  const courseGroups = useMemo(() => {
    const groups = new Map<string, DashboardCourse[]>();
    for (const course of dashboard.courses) {
      const courses = groups.get(course.term) ?? [];
      courses.push(course);
      groups.set(course.term, courses);
    }
    return [...groups.entries()]
      .sort(
        ([left], [right]) =>
          courseRecordTermSequence(right) - courseRecordTermSequence(left),
      )
      .map(([term, courses]) => ({
        term,
        courses: [...courses].sort((left, right) => left.code.localeCompare(right.code)),
        units: courses.reduce(
          (sum, course) =>
            sum + countedAcademicUnits(course.code, course.credits),
          0,
        ),
        average: weightedGradeAverage(courses),
      }));
  }, [dashboard.courses]);
  const termOptions = useMemo(
    () => Array.from(new Set([
      ...dashboard.terms.map((term) => term.label),
      ...dashboard.courses
        .map((course) => course.term)
        .filter((term) => term !== "Unscheduled"),
    ])).sort((left, right) => termSequence(left) - termSequence(right)),
    [dashboard.courses, dashboard.terms],
  );

  async function updateCourse(
    course: DashboardCourse,
    patch: { status: CourseStatus; term: string | null; grade: number | null },
  ) {
    setBusyCourseId(course.id);
    try {
      await requestJson<{ ok: true }>("/api/courses/" + encodeURIComponent(course.id), {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await onReload();
      setNotice(course.code + " was updated.");
    } finally {
      setBusyCourseId(null);
    }
  }

  async function removeCourse(course: DashboardCourse) {
    if (!window.confirm("Remove " + course.code + " from your academic record?")) {
      return;
    }
    setBusyCourseId(course.id);
    try {
      await requestJson<void>("/api/courses/" + encodeURIComponent(course.id), {
        method: "DELETE",
      });
      setNotice(course.code + " was removed.");
      await onReload();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The course could not be removed.",
      );
    } finally {
      setBusyCourseId(null);
    }
  }

  return (
    <div className="dashboard-panel">
      <section className="dashboard-hero">
        <div>
          <span className="eyebrow compact">
            {dashboard.profile?.catalogLabel || "Academic plan"}
          </span>
          <h1>
            Good to see your {dashboard.programs.length > 1 ? "plans" : "plan"},{" "}
            {dashboard.user.username}.
          </h1>
          <p>
            {dashboard.programs.length > 1 ? "Primary: " : ""}
            {dashboard.profile?.programTitle}
            {dashboard.profile?.credential
              ? " · " + dashboard.profile.credential
              : ""}
            {dashboard.programs.length > 1
              ? " · " + dashboard.programs.length + " tracked plans"
              : ""}
          </p>
        </div>
        <button className="button button-primary" type="button" onClick={onOpenCatalog}>
          Add a course
          <span aria-hidden="true">＋</span>
        </button>
      </section>

      {summary ? (
        <>
          <section className="degree-progress-card" aria-labelledby="degree-progress-title">
            <div className="degree-progress-main">
              <div>
                <span className="card-kicker">Completed progress</span>
                <h2 id="degree-progress-title">
                  {summary.requiredUnits
                    ? summary.completedUnits === null
                      ? "Completed units unknown"
                      : formatUnits(summary.completedUnits) +
                      " of " +
                      formatUnits(summary.requiredUnits) +
                      " units"
                    : summary.completedUnits === null
                      ? "Completed units unknown"
                      : formatUnits(summary.completedUnits) + " completed academic units"}
                </h2>
              </div>
              <strong>
                {summary.requiredUnits && summary.completedUnits !== null
                  ? Math.round(completedPercent) + "%"
                  : projectedUnits === null
                    ? "Projection unknown"
                    : formatUnits(projectedUnits) + " projected academic units"}
              </strong>
            </div>
            {summary.requiredUnits && summary.completedUnits !== null ? (
              <div
                className="progress-track large"
                role="progressbar"
                aria-label="Completed degree units"
                aria-valuemin={0}
                aria-valuemax={summary.requiredUnits}
                aria-valuenow={summary.completedUnits}
              >
                <span style={{ width: completedPercent + "%" }} />
              </div>
            ) : (
              <p className="progress-context">
                The catalog returned no single degree-unit target for this
                program. Requirement groups below remain the source of truth.
              </p>
            )}
            <div className="degree-progress-footer">
              <span>
                Projected with current plan:{" "}
                <strong>
                  {projectedUnits === null
                    ? "Unknown"
                    : formatUnits(projectedUnits) + " academic units"}
                </strong>
              </span>
              {summary.requirementsTotal === null ? (
                <span>Open Progress to evaluate requirement groups</span>
              ) : (
                <span>
                  {summary.requirementsMet ?? 0} of {summary.requirementsTotal}{" "}
                  requirement groups met
                </span>
              )}
            </div>
          </section>

          <section className="summary-grid" aria-label="Academic summary">
            <SummaryMetric
              label="Overall average"
              value={formatAverageWithGpa(summary.overallAverage)}
              note="Completed graded courses"
            />
            <SummaryMetric
              label="Major average"
              value={formatAverageWithGpa(summary.majorAverage)}
              note={
                summary.majorAverage == null
                  ? "More eligible grades may be needed"
                  : "Program-defined major courses"
              }
            />
            <SummaryMetric
              label="Needs review"
              value={
                summary.requirementsUnknown === null
                  ? "—"
                  : String(summary.requirementsUnknown)
              }
              note={
                summary.requirementsUnknown === null
                  ? "Calculated when Progress opens"
                  : "Rules or records with uncertainty"
              }
            />
          </section>
        </>
      ) : (
        <div className="inline-error" role="status">
          <strong>Progress is still being calculated.</strong>
          <span>Add a course or refresh this page in a moment.</span>
        </div>
      )}

      <section className="content-card course-record-card" aria-labelledby="course-record-title">
        <div className="content-card-header">
          <div>
            <span className="card-kicker">Your evidence</span>
            <h2 id="course-record-title">Course record</h2>
          </div>
          <button className="text-button" type="button" onClick={onOpenCatalog}>
            Add course
          </button>
        </div>

        {dashboard.courses.length === 0 ? (
          <div className="empty-state compact">
            <span className="state-symbol small" aria-hidden="true">＋</span>
            <h3>No courses yet</h3>
            <p>Add a completed, in-progress, or planned course to begin.</p>
            <button className="button button-primary" type="button" onClick={onOpenCatalog}>
              Browse courses
            </button>
          </div>
        ) : (
          <div className="course-term-groups">
            {courseGroups.map((group) => {
              const headingId = "course-term-" + group.term.replace(/[^A-Za-z0-9]+/g, "-");
              return (
                <section className="course-term-group" key={group.term} aria-labelledby={headingId}>
                  <div className="course-term-heading">
                    <div>
                      <span>Academic term</span>
                      <h3 id={headingId}>{group.term}</h3>
                    </div>
                    <div className="course-term-summary">
                      <strong>
                        {group.courses.length} {group.courses.length === 1 ? "course" : "courses"}
                        {" · "}{formatUnits(group.units)} academic units
                      </strong>
                      <span>
                        Term average: {formatAverageWithGpa(group.average)}
                      </span>
                    </div>
                  </div>
                  <div className="course-table-wrap">
                    <table className="course-table">
                      <caption className="sr-only">Courses recorded for {group.term}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Course</th>
                          <th scope="col">Grade</th>
                          <th scope="col">Status</th>
                          <th scope="col"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.courses.map((course) => (
                          <tr key={course.id}>
                            <td data-label="Course">
                              <strong>{course.code}</strong>
                              <span>{course.title}</span>
                              {course.nonAcademic && (
                                <small className="non-academic-badge">Non-academic</small>
                              )}
                            </td>
                            <td data-label="Grade">
                              {typeof course.grade === "number"
                                ? (
                                  <span className="course-grade-display">
                                    <strong>{course.grade.toFixed(1) + "%"}</strong>
                                    <small>{formatGpa(course.grade)}</small>
                                  </span>
                                )
                                : "—"}
                            </td>
                            <td data-label="Status">
                              <CourseStatusBadge status={course.status} />
                            </td>
                            <td className="course-actions">
                              <div className="course-action-buttons">
                                <button
                                  className="icon-button edit"
                                  type="button"
                                  disabled={busyCourseId === course.id}
                                  aria-label={"Edit " + course.code}
                                  onClick={() => setEditingCourse(course)}
                                >
                                  <span aria-hidden="true">✎</span>
                                </button>
                                <button
                                  className="icon-button danger"
                                  type="button"
                                  disabled={busyCourseId === course.id}
                                  aria-label={"Remove " + course.code}
                                  onClick={() => void removeCourse(course)}
                                >
                                  ×
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>
      {editingCourse && (
        <EditCourseDialog
          course={editingCourse}
          termOptions={termOptions}
          saving={busyCourseId === editingCourse.id}
          onClose={() => setEditingCourse(null)}
          onSave={(patch) => updateCourse(editingCourse, patch)}
        />
      )}
    </div>
  );
}

function RequirementCard({
  requirement,
  programId,
  anchorRegistry,
  trackedProgramAnchors,
  onOverrideNode,
}: {
  requirement: DashboardRequirement;
  programId: string;
  anchorRegistry: RequirementAnchorRegistry;
  trackedProgramAnchors: TrackedProgramAnchorRegistry;
  onOverrideNode: (target: RequirementOverrideEditorTarget) => void;
}) {
  const meta = requirementMeta[requirement.status];
  const root = requirement.root;
  const rootHasManualEdit = root?.containsManualOverride === true;
  const rootIsManuallyEdited = Boolean(root?.manualOverride);

  function openOverride(target: RequirementOverrideTarget) {
    onOverrideNode({
      ...target,
      programId,
      documentId: requirement.id,
      requirementTitle: requirement.title,
    });
  }

  return (
    <article className={classNames(
      "requirement-card requirement-" + requirement.status,
      rootHasManualEdit && "has-manual-overrides",
    )}>
      <div className="requirement-card-top">
        {root ? (
          <button
            className={classNames(
              "requirement-symbol requirement-override-root-trigger",
              requirement.status,
              rootIsManuallyEdited && "is-manually-overridden",
            )}
            type="button"
            aria-label={"Override " + requirement.title + " root status"}
            aria-haspopup="dialog"
            onClick={() => openOverride({
              nodeKey: root.nodeKey || requirementNodeKey(
                { nodeId: root.nodeId },
              ),
              node: root,
              isRoot: true,
            })}
          >
            {meta.symbol}
          </button>
        ) : (
          <span
            className={"requirement-symbol " + requirement.status}
            aria-hidden="true"
          >
            {meta.symbol}
          </span>
        )}
        <div className="requirement-title">
          <h3>{requirement.title}</h3>
          {requirement.description && <p>{requirement.description}</p>}
          {rootHasManualEdit && (
            <span className="requirement-manual-summary">Manual edits applied</span>
          )}
        </div>
        <span className={"requirement-state " + requirement.status}>
          {meta.label}
        </span>
      </div>

      {requirement.note && (
        <p className="requirement-note">{requirement.note}</p>
      )}

      {root && (
        <div className="requirement-ast">
          <RequirementTree
            root={root}
            documentId={requirement.id}
            anchorRegistry={anchorRegistry}
            trackedProgramAnchors={trackedProgramAnchors}
            showCourseActivity
            onOverrideNode={openOverride}
          />
        </div>
      )}

      <details className="requirement-details">
        <summary>Why this status</summary>
        <div>
          {requirement.evidence && requirement.evidence.length > 0 && (
            <>
              <strong>Counted</strong>
              <ul>
                {requirement.evidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>
          )}
          {requirement.missing && requirement.missing.length > 0 && (
            <>
              <strong>Still needed</strong>
              <ul>
                {requirement.missing.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>
          )}
          {!requirement.evidence?.length && !requirement.missing?.length && (
            <p>No additional evidence was returned for this rule.</p>
          )}
          {requirement.sourceLabel && (
            <small>Source: {requirement.sourceLabel}</small>
          )}
        </div>
      </details>
    </article>
  );
}

function ProgressPanel({
  dashboard,
  onReload,
  setNotice,
}: {
  dashboard: DashboardPayload;
  onReload: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [busyProgramId, setBusyProgramId] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<
    RequirementOverrideEditorTarget | null
  >(null);
  const [savingOverride, setSavingOverride] = useState(false);
  const [collapsedProgramIds, setCollapsedProgramIds] = useState<Set<string>>(
    () => new Set(),
  );
  const allProgramsCollapsed =
    dashboard.programs.length > 0 &&
    dashboard.programs.every((program) =>
      collapsedProgramIds.has(program.profile.id));
  const trackedProgramAnchors = buildTrackedProgramAnchorRegistry(
    dashboard.programs.map((program) => ({
      programPid: program.profile.programPid,
      programCode: program.profile.programCode,
      anchorId: "program-progress-" + program.profile.id,
    })),
  );

  function toggleProgram(programId: string) {
    setCollapsedProgramIds((current) => {
      const next = new Set(current);
      if (next.has(programId)) next.delete(programId);
      else next.add(programId);
      return next;
    });
  }

  function toggleAllPrograms() {
    setCollapsedProgramIds(
      allProgramsCollapsed
        ? new Set()
        : new Set(dashboard.programs.map((program) => program.profile.id)),
    );
  }

  async function removePlan(program: DashboardProgramProgress) {
    if (!window.confirm("Stop tracking " + program.profile.programTitle + "?")) {
      return;
    }
    setBusyProgramId(program.profile.id);
    try {
      await requestJson<void>(
        "/api/profile/program/" + encodeURIComponent(program.profile.id),
        { method: "DELETE" },
      );
      setNotice(program.profile.programTitle + " was removed from your tracked plans.");
      await onReload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The plan could not be removed.");
    } finally {
      setBusyProgramId(null);
    }
  }

  async function saveRequirementOverride(input: RequirementOverrideSaveInput) {
    if (!overrideTarget) return;
    setSavingOverride(true);
    try {
      await requestJson<{ success: true }>("/api/progress/overrides", {
        method: "PUT",
        body: JSON.stringify({
          userProgramId: overrideTarget.programId,
          documentId: overrideTarget.documentId,
          nodeKey: overrideTarget.nodeKey,
          ...input,
        }),
      });
      await onReload();
      setNotice("Manual requirement edit saved.");
      setOverrideTarget(null);
    } finally {
      setSavingOverride(false);
    }
  }

  async function revertRequirementOverride() {
    const overrideId = overrideTarget?.node.manualOverride?.id;
    if (!overrideId) return;
    setSavingOverride(true);
    try {
      await requestJson<{ success: true }>(
        "/api/progress/overrides/" + encodeURIComponent(overrideId),
        { method: "DELETE" },
      );
      await onReload();
      setNotice("Automatic requirement evaluation restored.");
      setOverrideTarget(null);
    } finally {
      setSavingOverride(false);
    }
  }

  return (
    <div className="dashboard-panel">
      <section className="panel-heading">
        <div>
          <span className="eyebrow compact">Completed evidence first</span>
          <h1>Program progress</h1>
          <p>
            Your shared course record is evaluated independently against all{" "}
            {dashboard.programs.length} tracked {dashboard.programs.length === 1 ? "plan" : "plans"}.
          </p>
        </div>
        <div className="progress-heading-controls">
          <button
            className="button button-secondary button-compact"
            type="button"
            onClick={toggleAllPrograms}
          >
            {allProgramsCollapsed ? "Expand all programs" : "Collapse all programs"}
          </button>
          <div className="segmented-control" aria-label="Requirement filter">
            <button
              type="button"
              className={filter === "all" ? "active" : ""}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={filter === "attention" ? "active" : ""}
              aria-pressed={filter === "attention"}
              onClick={() => setFilter("attention")}
            >
              Needs attention
            </button>
          </div>
        </div>
      </section>

      <div className="status-legend" aria-label="Requirement status legend">
        <span><i className="legend-dot met" /> Met by completed courses</span>
        <span><i className="legend-dot planned" /> On track with your plan</span>
        <span><i className="legend-dot unknown" /> Needs review</span>
      </div>

      <div className="program-progress-list">
        {dashboard.programs.map((program, index) => {
          const requirements = program.requirements.filter((requirement) =>
            filter === "all" ? true : requirement.status !== "met",
          );
          const anchorRegistry = buildRequirementAnchorRegistry(
            program.profile.programPid,
            requirements.map((requirement) => ({
              documentId: requirement.id,
              sourceField: requirement.sourceField,
              root: requirement.root ?? null,
            })),
          );
          const collapsed = collapsedProgramIds.has(program.profile.id);
          const programAnchorId = "program-progress-" + program.profile.id;
          const bodyId = "program-progress-body-" + program.profile.id;
          return (
            <section
              className={classNames(
                "program-progress-group",
                "requirement-anchor-target",
                collapsed && "is-collapsed",
              )}
              id={programAnchorId}
              key={program.profile.id}
              tabIndex={-1}
            >
              <header className="program-progress-heading">
                <div>
                  <span className="card-kicker">Tracked plan {index + 1}</span>
                  <h2>{program.profile.programTitle}</h2>
                  <p>
                    {[program.profile.programCode, program.profile.credential, program.profile.faculty]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="program-progress-actions">
                  {program.summary && (
                    <div className="program-progress-metrics" aria-label="Plan progress summary">
                      <span>
                        <strong>{program.summary.requirementsMet ?? "—"}</strong>
                        requirements met
                      </span>
                      <span>
                        <strong>{program.summary.requirementsTotal ?? "—"}</strong>
                        evaluated
                      </span>
                      <span>
                        <strong>{program.summary.requirementsUnknown ?? "—"}</strong>
                        need review
                      </span>
                    </div>
                  )}
                  <div className="program-progress-controls">
                    <button
                      className="text-button program-collapse-toggle"
                      type="button"
                      aria-expanded={!collapsed}
                      aria-controls={bodyId}
                      onClick={() => toggleProgram(program.profile.id)}
                    >
                      <span aria-hidden="true">{collapsed ? "▾" : "▴"}</span>
                      {collapsed ? "Expand program" : "Collapse program"}
                    </button>
                    <button
                      className="text-button danger-text"
                      type="button"
                      disabled={busyProgramId === program.profile.id}
                      onClick={() => void removePlan(program)}
                    >
                      {busyProgramId === program.profile.id ? "Removing…" : "Remove plan"}
                    </button>
                  </div>
                </div>
              </header>

              <div id={bodyId} className="program-progress-body" hidden={collapsed}>
                {program.calendarMismatch ? (
                  <div className="inline-error" role="alert">
                    <strong>Calendar reconfirmation required.</strong>
                    <span>This plan belongs to {program.profile.catalogLabel}.</span>
                  </div>
                ) : requirements.length === 0 ? (
                  <div className="program-requirements-empty">
                    <span aria-hidden="true">✓</span>
                    <p>
                      {filter === "attention"
                        ? "No requirements in this plan need attention."
                        : "No structured requirements are available for this plan."}
                    </p>
                  </div>
                ) : (
                  <div className="requirement-list">
                    {requirements.map((requirement) => (
                      <RequirementCard
                        key={program.profile.id + "-" + requirement.id}
                        requirement={requirement}
                        programId={program.profile.id}
                        anchorRegistry={anchorRegistry}
                        trackedProgramAnchors={trackedProgramAnchors}
                        onOverrideNode={setOverrideTarget}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <aside className="academic-notice">
        <strong>Check important decisions with an advisor.</strong>
        <p>
          “Needs review” is intentional: opaque prose, missing grades, and
          partially parsed rules are never treated as satisfied.
        </p>
      </aside>

      {overrideTarget && (
        <RequirementOverrideDialog
          key={
            overrideTarget.programId +
            ":" +
            overrideTarget.documentId +
            ":" +
            overrideTarget.nodeKey
          }
          target={overrideTarget}
          saving={savingOverride}
          onClose={() => {
            if (!savingOverride) setOverrideTarget(null);
          }}
          onSave={saveRequirementOverride}
          onRevert={revertRequirementOverride}
        />
      )}
    </div>
  );
}

function PlannerPanel({
  dashboard,
  onAddToTerm,
  onReviewSuggestion,
  onReload,
  busyCourseId,
  setBusyCourseId,
  setNotice,
}: {
  dashboard: DashboardPayload;
  onAddToTerm: (term: string) => void;
  onReviewSuggestion: (courseCode: string, term: string) => void;
  onReload: () => Promise<void>;
  busyCourseId: string | null;
  setBusyCourseId: (id: string | null) => void;
  setNotice: (message: string) => void;
}) {
  const [eligibilityCheckState, setEligibilityCheckState] = useState<
    "idle" | "checking"
  >("idle");
  const [eligibilityResults, setEligibilityResults] = useState(
    () => new Map<string, ApiPlannerEligibilityResult>(),
  );
  const terms = useMemo(() => {
    const sorted = [...dashboard.terms].sort((a, b) => a.sequence - b.sequence);
    const knownLabels = new Set(sorted.map((term) => term.label));
    const extraLabels = dashboard.courses
      .filter(
        (course) =>
          course.status === "planned" &&
          course.term &&
          !knownLabels.has(course.term),
      )
      .map((course) => course.term);
    const uniqueExtras = Array.from(new Set(extraLabels));
    return [
      ...sorted,
      ...uniqueExtras.map((label, index) => ({
        id: "extra-" + index,
        label,
        sequence: sorted.length + index,
      })),
    ];
  }, [dashboard.courses, dashboard.terms]);
  const plannedCourseCount = dashboard.courses.filter(
    (course) => course.status === "planned",
  ).length;
  const plannedCourseKey = useMemo(
    () => dashboard.courses
      .filter((course) => course.status === "planned")
      .map((course) => `${course.id}:${course.term}`)
      .sort()
      .join("|"),
    [dashboard.courses],
  );

  const checkEligibility = useCallback(async (announce = true) => {
    setEligibilityCheckState("checking");
    try {
      const response = await requestJson<ApiPlannerEligibilityPayload>(
        "/api/planner/eligibility",
      );
      setEligibilityResults(
        new Map(response.results.map((result) => [result.courseId, result])),
      );
      if (announce) {
        setNotice(
          response.results.length === 1
            ? "Eligibility checked for 1 planned course."
            : "Eligibility checked for " +
              response.results.length +
              " planned courses.",
        );
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Planner eligibility could not be checked.",
      );
    } finally {
      setEligibilityCheckState("idle");
    }
  }, [setNotice]);

  useEffect(() => {
    if (!plannedCourseKey) {
      setEligibilityResults(new Map());
      return;
    }
    void checkEligibility(false);
  }, [checkEligibility, plannedCourseKey]);

  function checkedEligibilityStatus(
    result: ApiPlannerEligibilityResult,
  ): EligibilityStatus {
    if (result.state === "MET") {
      return result.reliesOnPlanned ? "provisional" : "eligible";
    }
    if (result.state === "NOT_MET") return "blocked";
    return "unknown";
  }

  function checkedEligibilityMessage(
    result: ApiPlannerEligibilityResult,
  ): string {
    if (result.state === "MET") {
      return result.reliesOnPlanned
        ? "Eligible when planned courses in earlier terms are included."
        : "Eligible based on courses in earlier terms.";
    }
    if (result.state === "NOT_MET") {
      return result.unmetCourseCodes.length > 0
        ? "Needed in an earlier term: " +
            result.unmetCourseCodes.join(", ") +
            "."
        : "One or more catalog requirements are not met by earlier terms.";
    }
    return result.unknownReasons[0] || "Some catalog requirements need review.";
  }

  async function moveCourse(course: DashboardCourse, term: PlannerTerm) {
    setBusyCourseId(course.id);
    try {
      await requestJson<{ ok: true }>("/api/courses/" + encodeURIComponent(course.id), {
        method: "PATCH",
        body: JSON.stringify({ status: "planned", term: term.label }),
      });
      setEligibilityResults(new Map());
      setNotice(course.code + " moved to " + term.label + ".");
      await onReload();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The course could not be moved.",
      );
    } finally {
      setBusyCourseId(null);
    }
  }

  return (
    <div className="dashboard-panel">
      <section className="panel-heading">
        <div>
          <span className="eyebrow compact">Projected, not completed</span>
          <h1>Future-term planner</h1>
          <p>
            Arrange candidate courses and check whether earlier completed or
            planned courses make them eligible by that term.
          </p>
        </div>
        <div className="panel-heading-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={
              plannedCourseCount === 0 || eligibilityCheckState === "checking"
            }
            onClick={() => void checkEligibility(true)}
          >
            {eligibilityCheckState === "checking"
              ? "Checking eligibility…"
              : "Check eligibility"}
            <span aria-hidden="true">✓</span>
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={() => onAddToTerm(terms[0]?.label || "")}
          >
            Add planned course
            <span aria-hidden="true">＋</span>
          </button>
        </div>
      </section>

      <div className="planner-notice">
        <span aria-hidden="true">i</span>
        <p>
          This planner checks catalog requirements, not class offerings,
          enrolment capacity, or timetable conflicts. Confirm availability in
          Quest.
        </p>
      </div>

      <section
        className="suggested-courses"
        aria-labelledby="suggested-courses-title"
      >
        <div className="suggested-courses-header">
          <div>
            <span className="card-kicker">Planning prompts</span>
            <h2 id="suggested-courses-title">Suggested next courses</h2>
          </div>
          <p>
            Courses that advance more of your tracked plans appear first and
            are highlighted. Suggestions are not a guarantee that every rule
            will be satisfied.
          </p>
        </div>

        {dashboard.suggestions.length === 0 ? (
          <div className="suggestions-empty">
            <span aria-hidden="true">i</span>
            <p>
              No course-level suggestions are available yet. Add more course
              history or review requirements marked “Needs review.”
            </p>
          </div>
        ) : (
          <div className="suggestion-grid">
            {dashboard.suggestions.slice(0, 6).map((suggestion) => (
              <article
                className={classNames(
                  "suggestion-card",
                  suggestion.planCount > 1 && "multi-plan",
                )}
                key={suggestion.courseCode}
              >
                <div className="suggestion-card-top">
                  <div>
                    <strong>{suggestion.courseCode}</strong>
                    <h3>{suggestion.title || "Catalog course"}</h3>
                  </div>
                  {suggestion.planCount > 1 ? (
                    <span className="multi-plan-badge">
                      Best overlap · {suggestion.planCount} plans
                    </span>
                  ) : suggestion.isOption ? (
                    <span>One option</span>
                  ) : null}
                </div>
                <p>
                  <strong>May help:</strong> {suggestion.reason}
                </p>
                {suggestion.programs.length > 0 && (
                  <div className="suggestion-plan-tags" aria-label="Plans this course may advance">
                    {suggestion.programs.map((program) => (
                      <span key={program.programCode} title={program.programTitle}>
                        {program.programCode}
                      </span>
                    ))}
                  </div>
                )}
                <div className="suggestion-card-footer">
                  <span>
                    {isNonAcademicCourseCode(suggestion.courseCode)
                      ? "Non-academic"
                      : suggestion.credits == null
                      ? "Units vary"
                      : formatUnits(suggestion.credits) + " units"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onReviewSuggestion(
                        suggestion.courseCode,
                        terms[0]?.label || "",
                      )
                    }
                  >
                    Review and plan <span aria-hidden="true">→</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {terms.length === 0 ? (
        <div className="empty-state">
          <span className="state-symbol small" aria-hidden="true">↗</span>
          <h2>No planning terms yet</h2>
          <p>Add a planned course with a term to start your roadmap.</p>
          <button
            className="button button-primary"
            type="button"
            onClick={() => onAddToTerm("")}
          >
            Browse courses
          </button>
        </div>
      ) : (
        <div className="planner-board" aria-label="Future terms">
          {terms.map((term, termIndex) => {
            const courses = dashboard.courses.filter(
              (course) =>
                course.status === "planned" && course.term === term.label,
            );
            return (
              <section
                className="term-row"
                key={term.id}
                aria-labelledby={"term-" + term.id}
              >
                <div className="term-row-header">
                  <div>
                    <span>Term {termIndex + 1}</span>
                    <h2 id={"term-" + term.id}>{term.label}</h2>
                  </div>
                  <strong>
                    {formatUnits(
                      courses.reduce(
                        (sum, course) =>
                          sum + countedAcademicUnits(course.code, course.credits),
                        0,
                      ),
                    )}{" "}
                    academic units
                  </strong>
                  <button
                    className="add-to-term"
                    type="button"
                    onClick={() => onAddToTerm(term.label)}
                  >
                    <span aria-hidden="true">＋</span>
                    Add to {term.label}
                  </button>
                </div>
                <div className="term-courses">
                  {courses.length === 0 && (
                    <div className="term-empty">No planned courses</div>
                  )}
                  {courses.map((course) => {
                    const checkedEligibility = eligibilityResults.get(course.id);
                    const eligibilityStatus = checkedEligibility
                      ? checkedEligibilityStatus(checkedEligibility)
                      : course.eligibility;
                    const eligibilityMessage = checkedEligibility
                      ? checkedEligibilityMessage(checkedEligibility)
                      : course.eligibilityMessage;
                    return (
                      <article className="planned-course-card" key={course.id}>
                        <div className="planned-course-top">
                          <div>
                            <strong>{course.code}</strong>
                            <h3>{course.title}</h3>
                          </div>
                          <span>
                            {course.nonAcademic
                              ? "Non-academic"
                              : formatUnits(course.credits) + " units"}
                          </span>
                        </div>
                        <EligibilityBadge status={eligibilityStatus} />
                        {eligibilityMessage && <p>{eligibilityMessage}</p>}
                        {course.fulfills && course.fulfills.length > 0 && (
                          <small>Counts toward {course.fulfills.join(", ")}</small>
                        )}
                        <div
                          className="move-controls"
                          aria-label={"Move " + course.code}
                        >
                          <button
                            type="button"
                            disabled={
                              termIndex === 0 || busyCourseId === course.id
                            }
                            onClick={() =>
                              void moveCourse(course, terms[termIndex - 1])
                            }
                            aria-label={"Move " + course.code + " to previous term"}
                          >
                            ← Earlier
                          </button>
                          <button
                            type="button"
                            disabled={
                              termIndex === terms.length - 1 ||
                              busyCourseId === course.id
                            }
                            onClick={() =>
                              void moveCourse(course, terms[termIndex + 1])
                            }
                            aria-label={"Move " + course.code + " to next term"}
                          >
                            Later →
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LegacyCatalogPanel({
  dashboard,
  initialQuery,
  initialTerm,
  initialStatus,
  onAdded,
  setNotice,
}: {
  dashboard: DashboardPayload;
  initialQuery: string;
  initialTerm: string;
  initialStatus: CourseStatus;
  onAdded: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const searchId = useId();
  const termListId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<CatalogCourse[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [searchError, setSearchError] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<CatalogCourse | null>(
    null,
  );
  const [status, setStatus] = useState<CourseStatus>(initialStatus);
  const [term, setTerm] = useState(initialTerm);
  const [grade, setGrade] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving">("idle");
  const [formError, setFormError] = useState("");

  const searchCourses = useCallback(
    async (searchQuery: string, signal?: AbortSignal) => {
      const cleanQuery = searchQuery.trim();
      if (cleanQuery.length < 2) {
        setResults([]);
        setSearchState("idle");
        return;
      }
      setSearchState("loading");
      setSearchError("");
      try {
        const payload = await requestJson<CourseSearchPayload>(
          "/api/catalog/courses?q=" +
            encodeURIComponent(cleanQuery) +
            "&limit=12",
          { signal },
        );
        const normalizedCourses = payload.items
          ? payload.items
          : (payload.courses || []).map((course) => ({
              pid: course.pid,
              code: course.code,
              title: course.title,
              credits: course.credits ?? course.creditMin ?? 0,
              description: course.description || null,
            }));
        setResults(normalizedCourses);
        setSearchState("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchError(
          error instanceof Error ? error.message : "Courses could not be loaded.",
        );
        setSearchState("error");
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchCourses(query, controller.signal);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchCourses]);

  function selectCourse(course: CatalogCourse) {
    setSelectedCourse(course);
    setFormError("");
    setGrade("");
  }

  async function addCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCourse) return;
    const cleanTerm = term.trim();
    if (
      (status === "planned" || status === "in_progress") &&
      !cleanTerm
    ) {
      setFormError("Enter the term for this planned or in-progress course.");
      return;
    }
    const numericGrade = grade.trim() === "" ? null : Number(grade);
    if (
      numericGrade !== null &&
      (!Number.isFinite(numericGrade) || numericGrade < 0 || numericGrade > 100)
    ) {
      setFormError("Grade must be between 0 and 100.");
      return;
    }

    setSaveState("saving");
    setFormError("");
    try {
      const response = await requestJson<ApiCourseMutationPayload>(
        "/api/courses",
        {
          method: "POST",
          body: JSON.stringify({
            courseCode: selectedCourse.code,
            status,
            term: cleanTerm || null,
            grade:
              status === "completed" || status === "transfer"
                ? numericGrade
                : null,
          }),
        },
      );
      const eligibilityNote =
        status === "planned" && response.eligibility
          ? response.eligibility.state === "MET"
            ? " Its current prerequisites are met."
            : response.eligibility.state === "NOT_MET"
              ? " One or more prerequisites are not yet met."
              : " Its prerequisites need review."
          : "";
      setNotice(
        selectedCourse.code +
          " was added as " +
          courseStatusLabels[status].toLowerCase() +
          "." +
          eligibilityNote,
      );
      setSelectedCourse(null);
      setQuery("");
      setResults([]);
      setGrade("");
      await onAdded();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "The course could not be added.",
      );
    } finally {
      setSaveState("idle");
    }
  }

  const termLabels = Array.from(
    new Set([
      ...dashboard.terms.map((plannerTerm) => plannerTerm.label),
      ...dashboard.courses.map((course) => course.term),
    ]),
  ).filter(Boolean);

  return (
    <div className="dashboard-panel catalog-panel">
      <section className="panel-heading catalog-heading">
        <div>
          <span className="eyebrow compact">
            {dashboard.profile?.catalogLabel || "Deployment-configured calendar"}
          </span>
          <h1>Course catalog</h1>
          <p>
            Search the active Waterloo snapshot, then add a course to your
            completed record, current term, or future plan.
          </p>
        </div>
      </section>

      <section className="catalog-search-card" aria-labelledby="catalog-search-title">
        <h2 id="catalog-search-title">Find a course</h2>
        <label htmlFor={searchId}>Course code or title</label>
        <div className="search-field large">
          <span aria-hidden="true">⌕</span>
          <input
            id={searchId}
            type="search"
            role="combobox"
            aria-expanded={searchState === "ready" && results.length > 0}
            aria-controls={searchId + "-results"}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search CS 246, algorithms, statistics…"
          />
          {searchState === "loading" && (
            <span className="spinner" aria-label="Searching" />
          )}
        </div>

        {selectedCourse && (
          <form className="add-course-form" onSubmit={addCourse}>
            <div className="selected-course-heading">
              <div>
                <span>Adding</span>
                <h3>{selectedCourse.code} · {selectedCourse.title}</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close add course form"
                onClick={() => setSelectedCourse(null)}
              >
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                Status
                <select
                  value={status}
                  onChange={(event) => {
                    const nextStatus = event.target.value as CourseStatus;
                    setStatus(nextStatus);
                    if (
                      nextStatus === "planned" ||
                      nextStatus === "in_progress"
                    ) {
                      setGrade("");
                    }
                  }}
                >
                  <option value="completed">Completed</option>
                  <option value="in_progress">In progress</option>
                  <option value="planned">Planned</option>
                  <option value="transfer">Transfer</option>
                </select>
              </label>
              <label>
                Term
                <input
                  type="text"
                  list={termListId}
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Fall 2026"
                  autoComplete="off"
                />
                <datalist id={termListId}>
                  {termLabels.map((label) => (
                    <option value={label} key={label} />
                  ))}
                </datalist>
              </label>
              <label>
                Grade <span>(optional)</span>
                <div className="grade-field">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.1"
                    value={grade}
                    onChange={(event) => setGrade(event.target.value)}
                    disabled={
                      status !== "completed" && status !== "transfer"
                    }
                  />
                  <span aria-hidden="true">%</span>
                </div>
              </label>
            </div>
            {selectedCourse.eligibility && (
              <div className="selected-eligibility">
                <EligibilityBadge status={selectedCourse.eligibility} />
                {selectedCourse.eligibilityMessage && (
                  <p>{selectedCourse.eligibilityMessage}</p>
                )}
              </div>
            )}
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="form-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setSelectedCourse(null)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={saveState === "saving"}
              >
                {saveState === "saving" ? "Adding…" : "Add course"}
              </button>
            </div>
          </form>
        )}

        <div id={searchId + "-results"} className="catalog-results-region">
          {searchState === "idle" && (
            <div className="catalog-prompt">
              <span className="state-symbol small" aria-hidden="true">⌕</span>
              <h3>Search the academic calendar</h3>
              <p>Try a course code such as CS 246 or a title keyword.</p>
            </div>
          )}
          {searchState === "error" && (
            <div className="inline-error" role="alert">
              <strong>Course search is unavailable.</strong>
              <span>{searchError}</span>
              <button type="button" onClick={() => void searchCourses(query)}>
                Retry
              </button>
            </div>
          )}
          {searchState === "ready" && results.length === 0 && (
            <div className="inline-empty">
              No active course matched “{query.trim()}”. Check the code or try
              fewer words.
            </div>
          )}
          {searchState === "ready" && results.length > 0 && (
            <div className="catalog-results" role="list" aria-label="Course results">
              {results.map((course) => (
                <article className="catalog-course-card" role="listitem" key={course.pid}>
                  <div className="catalog-course-main">
                    <div className="course-code-box">{course.code}</div>
                    <div>
                      <h3>{course.title}</h3>
                      <p>{course.description || "No description available."}</p>
                      <div className="catalog-course-meta">
                        <span>
                          {isNonAcademicCourseCode(course.code)
                            ? "Non-academic"
                            : formatUnits(course.credits) + " units"}
                        </span>
                        {course.eligibility && (
                          <EligibilityBadge status={course.eligibility} />
                        )}
                      </div>
                    </div>
                  </div>
                  {course.prerequisiteSummary && (
                    <p className="prerequisite-summary">
                      <strong>Prerequisites:</strong> {course.prerequisiteSummary}
                    </p>
                  )}
                  {course.eligibilityMessage && (
                    <p className="eligibility-message">{course.eligibilityMessage}</p>
                  )}
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => selectCourse(course)}
                  >
                    Add course
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

void LegacyCatalogPanel;

export function AcademicDashboard({
  initialBrowserTab = null,
  initialQuery = "",
  initialCoursePid = "",
  initialProgramPid = "",
}: {
  initialBrowserTab?: "plans" | "courses" | null;
  initialQuery?: string;
  initialCoursePid?: string;
  initialProgramPid?: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>(
    initialBrowserTab ? "catalog" : "overview",
  );
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "error" | "guest"
  >("loading");
  const [tabLoadStates, setTabLoadStates] = useState<
    Record<"progress" | "planner", "idle" | "loading" | "ready" | "error">
  >({ progress: "idle", planner: "idle" });
  const [tabLoadErrors, setTabLoadErrors] = useState<
    Record<"progress" | "planner", string>
  >({ progress: "", planner: "" });
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyCourseId, setBusyCourseId] = useState<string | null>(null);
  const [catalogInitialQuery, setCatalogInitialQuery] = useState(initialQuery);
  const [catalogInitialTerm, setCatalogInitialTerm] = useState("");
  const [catalogInitialStatus, setCatalogInitialStatus] =
    useState<CourseStatus>("completed");
  const scopeRequestIds = useRef<Record<DashboardDataScope, number>>({
    overview: 0,
    progress: 0,
    planner: 0,
  });

  const loadDashboardScope = useCallback(async (scope: DashboardDataScope) => {
    const requestId = ++scopeRequestIds.current[scope];
    if (scope === "overview") {
      setLoadError("");
    } else {
      setTabLoadErrors((current) => ({ ...current, [scope]: "" }));
      setTabLoadStates((current) => ({ ...current, [scope]: "loading" }));
    }
    try {
      const payload = await requestJson<DashboardPayload | ApiDashboardPayload>(
        "/api/dashboard?tab=" + scope,
      );
      if (scopeRequestIds.current[scope] !== requestId) return;
      const normalized = normalizeDashboardPayload(payload);
      setDashboard((current) => mergeDashboardScope(current, normalized, scope));
      if (scope === "overview") {
        setLoadState("ready");
      } else {
        setTabLoadStates((current) => ({ ...current, [scope]: "ready" }));
      }
    } catch (error) {
      if (scopeRequestIds.current[scope] !== requestId) return;
      if (error instanceof ApiError && error.status === 401) {
        setLoadState("guest");
        return;
      }
      const message = error instanceof Error
        ? error.message
        : "Your plan could not be loaded.";
      if (scope === "overview") {
        setLoadError(message);
        setLoadState("error");
      } else {
        setTabLoadErrors((current) => ({ ...current, [scope]: message }));
        setTabLoadStates((current) => ({ ...current, [scope]: "error" }));
      }
    }
  }, []);

  const reloadOverview = useCallback(async () => {
    scopeRequestIds.current.progress += 1;
    scopeRequestIds.current.planner += 1;
    setTabLoadStates({ progress: "idle", planner: "idle" });
    setTabLoadErrors({ progress: "", planner: "" });
    await loadDashboardScope("overview");
  }, [loadDashboardScope]);

  const reloadProgress = useCallback(async () => {
    scopeRequestIds.current.planner += 1;
    setTabLoadStates((current) => ({
      ...current,
      planner: "idle",
    }));
    setDashboard((current) => current
      ? { ...current, suggestions: [] }
      : current);
    await loadDashboardScope("progress");
  }, [loadDashboardScope]);

  const reloadPlanner = useCallback(async () => {
    scopeRequestIds.current.progress += 1;
    setTabLoadStates((current) => ({
      ...current,
      progress: "idle",
    }));
    await loadDashboardScope("planner");
  }, [loadDashboardScope]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboardScope("overview");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboardScope]);

  useEffect(() => {
    if (
      loadState !== "ready" ||
      !dashboard?.profile ||
      dashboard.calendarMismatch ||
      (activeTab !== "progress" && activeTab !== "planner") ||
      tabLoadStates[activeTab] !== "idle"
    ) {
      return;
    }
    void loadDashboardScope(activeTab);
  }, [
    activeTab,
    dashboard?.calendarMismatch,
    dashboard?.profile,
    loadDashboardScope,
    loadState,
    tabLoadStates,
  ]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function openCatalog(
    status: CourseStatus = "completed",
    term = "",
    query = "",
  ) {
    setCatalogInitialStatus(status);
    setCatalogInitialTerm(term);
    setCatalogInitialQuery(query);
    setActiveTab("catalog");
    window.requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const showTabs =
    loadState === "ready" &&
    Boolean(dashboard && dashboard.profile && !dashboard.calendarMismatch);

  if (loadState === "guest") {
    return (
      <GuestAcademicExplorer
        initialTab={initialBrowserTab ?? "plans"}
        initialQuery={initialQuery}
        initialCoursePid={initialCoursePid}
        initialProgramPid={initialProgramPid}
      />
    );
  }

  return (
    <div className="app-page">
      <DashboardHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        user={dashboard?.user}
        showTabs={showTabs}
      />

      {loadState === "loading" && (
        <main id="main-content"><AppLoading /></main>
      )}
      {loadState === "error" && (
        <main id="main-content">
          <AppError
            title="Your plan did not load."
            message={loadError}
            onRetry={() => {
              setLoadState("loading");
              void loadDashboardScope("overview");
            }}
          />
        </main>
      )}
      {loadState === "ready" &&
        dashboard &&
        (!dashboard.profile || dashboard.calendarMismatch) && (
        <ProgramOnboarding
          user={dashboard.user}
          activeCatalog={dashboard.catalog}
          calendarMismatch={
            dashboard.calendarMismatch && dashboard.profile
              ? {
                  programTitle: dashboard.profile.programTitle,
                  savedCalendarLabel: dashboard.profile.catalogLabel,
                  activeCalendarLabel:
                    dashboard.catalog?.label || "active calendar",
                }
              : null
          }
          onComplete={reloadOverview}
        />
      )}
      {loadState === "ready" &&
        dashboard?.profile &&
        !dashboard.calendarMismatch && (
        <>
          <main
            id="main-content"
            className="dashboard-main shell"
            tabIndex={-1}
            role="tabpanel"
            aria-label={tabs.find((tab) => tab.id === activeTab)?.label}
          >
            {activeTab === "overview" && (
              <OverviewPanel
                dashboard={dashboard}
                onOpenCatalog={() => openCatalog("completed", "")}
                onReload={reloadOverview}
                busyCourseId={busyCourseId}
                setBusyCourseId={setBusyCourseId}
                setNotice={setNotice}
              />
            )}
            {activeTab === "progress" &&
              tabLoadStates.progress === "ready" && (
              <ProgressPanel
                dashboard={dashboard}
                onReload={reloadProgress}
                setNotice={setNotice}
              />
            )}
            {activeTab === "progress" &&
              (tabLoadStates.progress === "idle" ||
                tabLoadStates.progress === "loading") && (
              <DeferredTabLoading label="Progress" />
            )}
            {activeTab === "progress" &&
              tabLoadStates.progress === "error" && (
              <DeferredTabError
                label="Progress"
                message={tabLoadErrors.progress}
                onRetry={() => void loadDashboardScope("progress")}
              />
            )}
            {activeTab === "planner" &&
              tabLoadStates.planner === "ready" && (
              <PlannerPanel
                dashboard={dashboard}
                onAddToTerm={(term) => openCatalog("planned", term)}
                onReviewSuggestion={(courseCode, term) =>
                  openCatalog("planned", term, courseCode)
                }
                onReload={reloadPlanner}
                busyCourseId={busyCourseId}
                setBusyCourseId={setBusyCourseId}
                setNotice={setNotice}
              />
            )}
            {activeTab === "planner" &&
              (tabLoadStates.planner === "idle" ||
                tabLoadStates.planner === "loading") && (
              <DeferredTabLoading label="Planner" />
            )}
            {activeTab === "planner" &&
              tabLoadStates.planner === "error" && (
              <DeferredTabError
                label="Planner"
                message={tabLoadErrors.planner}
                onRetry={() => void loadDashboardScope("planner")}
              />
            )}
            {activeTab === "catalog" && (
              <CatalogPanel
                key={
                  catalogInitialStatus +
                  "-" +
                  catalogInitialTerm +
                  "-" +
                  catalogInitialQuery
                }
                dashboard={dashboard}
                initialQuery={catalogInitialQuery}
                initialBrowserTab={initialBrowserTab ?? "courses"}
                initialCoursePid={initialCoursePid}
                initialProgramPid={initialProgramPid}
                initialTerm={catalogInitialTerm}
                initialStatus={catalogInitialStatus}
                onAdded={reloadOverview}
                setNotice={setNotice}
              />
            )}
          </main>
          <DashboardTabs
            activeTab={activeTab}
            onChange={setActiveTab}
            className="mobile-dashboard-nav"
          />
        </>
      )}

      <div
        className={classNames("toast", notice && "visible")}
        role="status"
        aria-live="polite"
      >
        {notice}
      </div>
    </div>
  );
}
