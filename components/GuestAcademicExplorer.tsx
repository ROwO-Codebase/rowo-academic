"use client";

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";
import type {
  AcademicCourse,
  AcademicProgram,
  CatalogMetadata,
} from "@/lib/types";
import type { PublicRequirementSummary } from "@/lib/public-academic";
import { isNonAcademicCourseCode } from "@/lib/course-records";
import { buildRequirementAnchorRegistry } from "@/lib/requirement-anchors";
import { isCourseRequirementSection } from "@/lib/requirement-sections";
import {
  redditCourseSearchUrl,
  uwflowCourseUrl,
  waterlooCourseOutlineUrl,
} from "@/lib/course-links";
import { Brand } from "./Brand";
import {
  RequirementTree,
  type RequirementTreeNodeData,
} from "./RequirementTree";

type GuestTab = "plans" | "courses";
type LoadState = "idle" | "loading" | "ready" | "error";
type CourseStatus = "completed" | "in_progress" | "planned" | "transfer";

interface ProgramSearchPayload {
  programs: AcademicProgram[];
  catalog: CatalogMetadata;
}

interface CourseSearchPayload {
  courses: AcademicCourse[];
}

interface ProgramDetailPayload {
  program: AcademicProgram;
  requirements: PublicRequirementSummary[];
  catalog: CatalogMetadata;
}

interface ProgramMutationPayload {
  success: boolean;
}

interface CourseDetailPayload {
  course: AcademicCourse;
  requirements: PublicRequirementSummary[];
  catalog: CatalogMetadata;
  eligibility: CourseEligibilityPayload | null;
  viewer: {
    signedIn: boolean;
    recordedCount: number;
  };
}

interface CourseEligibilityPayload {
  state: "MET" | "NOT_MET" | "UNKNOWN";
  eligible: boolean;
  needsReview: boolean;
  unmetCourseCodes: string[];
  unknownReasons: string[];
  documents: Array<{
    documentId: string;
    root: RequirementTreeNodeData | null;
  }>;
}

interface CourseMutationPayload {
  success: boolean;
  eligibility?: CourseEligibilityPayload | null;
}

class BrowserApiError extends Error {}

async function requestBrowserJson<T>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(input, {
    ...init,
    headers,
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string | { message?: string } }
    | null;
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : payload?.error?.message || "The academic calendar could not be loaded.";
    throw new BrowserApiError(message);
  }
  return payload as T;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatUnits(value: number | null | undefined): string {
  if (value == null) return "Units vary";
  return (Number.isInteger(value) ? value.toFixed(1) : String(value)) + " units";
}

function readableLabel(value: string): string {
  const text = value.replace(/[_-]+/g, " ").trim();
  return text
    ? text.charAt(0).toUpperCase() + text.slice(1)
    : "Calendar requirement";
}

function updateAcademicDetailUrl(tab: GuestTab, pid: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  url.searchParams.set(tab === "plans" ? "plan" : "course", pid);
  url.searchParams.delete(tab === "plans" ? "course" : "plan");
  window.history.replaceState(null, "", url);
}

function GuestTabs({
  activeTab,
  onChange,
  className,
}: {
  activeTab: GuestTab;
  onChange: (tab: GuestTab) => void;
  className: string;
}) {
  return (
    <nav className={className} aria-label="Guest academic views">
      <div className="dashboard-tabs" role="tablist" aria-label="Guest views">
        {([
          ["plans", "Plans"],
          ["courses", "Courses"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={classNames("dashboard-tab", activeTab === id && "active")}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function GuestHeader({
  activeTab,
  onTabChange,
}: {
  activeTab: GuestTab;
  onTabChange: (tab: GuestTab) => void;
}) {
  return (
    <header className="site-header dashboard-header">
      <div className="site-header-inner">
        <Brand href="/app" />
        <GuestTabs
          activeTab={activeTab}
          onChange={onTabChange}
          className="desktop-dashboard-nav"
        />
        <a
          className="button button-primary button-compact"
          href="/auth/login?return_to=%2Fapp"
        >
          Sign in to save
        </a>
      </div>
    </header>
  );
}

function GuestNotice() {
  return (
    <aside className="guest-notice" aria-label="Guest browsing notice">
      <span aria-hidden="true">i</span>
      <div>
        <strong>Browsing as a guest</strong>
        <p>
          Plan and course information comes from the active calendar. Nothing
          is saved until you sign in with ROwO.
        </p>
      </div>
      <a href="/auth/login?return_to=%2Fapp">Sign in to build a saved plan</a>
    </aside>
  );
}

function RequirementInformation({
  requirements,
  emptyMessage,
  ownerPid,
  evaluations = [],
  courseRequirementParseStatusOnly = false,
}: {
  requirements: PublicRequirementSummary[];
  emptyMessage: string;
  ownerPid: string;
  evaluations?: Array<{
    documentId: string;
    root: RequirementTreeNodeData | null;
  }>;
  courseRequirementParseStatusOnly?: boolean;
}) {
  if (requirements.length === 0) {
    return <div className="inline-empty">{emptyMessage}</div>;
  }

  const anchorRegistry = buildRequirementAnchorRegistry(
    ownerPid,
    requirements.map((requirement) => ({
      documentId: requirement.id,
      sourceField: requirement.sourceField,
      root: requirement.root,
    })),
  );

  return (
    <div className="guest-requirement-list">
      {requirements.map((requirement, index) => (
        <details
          className="guest-requirement-card"
          key={requirement.id}
          open={index === 0}
        >
          <summary>
            <span>
              <strong>{readableLabel(requirement.kind)}</strong>
              <small>{readableLabel(requirement.sourceField)}</small>
            </span>
            {(!courseRequirementParseStatusOnly ||
              isCourseRequirementSection(requirement.kind)) && (
              <span className={"parse-status parse-" + requirement.parseStatus}>
                {readableLabel(requirement.parseStatus)}
              </span>
            )}
          </summary>
          <div className="guest-requirement-body">
            {requirement.root ? (
              <RequirementTree
                root={requirement.root}
                documentId={requirement.id}
                anchorRegistry={anchorRegistry}
                evaluation={
                  evaluations.find((item) => item.documentId === requirement.id)?.root
                }
              />
            ) : requirement.description ? (
              <p>{requirement.description}</p>
            ) : (
              <p>No machine-readable requirement tree is available.</p>
            )}
            {requirement.warnings.length > 0 && (
              <p className="guest-requirement-warning">
                Some parts need manual review: {requirement.warnings.join(" ")}
              </p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function PlanExplorer({
  signedIn = false,
  initialQuery = "",
  initialPid = "",
  savedProgramCodes = [],
  onAdded,
  setNotice,
}: {
  signedIn?: boolean;
  initialQuery?: string;
  initialPid?: string;
  savedProgramCodes?: string[];
  onAdded?: () => Promise<void>;
  setNotice?: (message: string) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<AcademicProgram[]>([]);
  const [catalog, setCatalog] = useState<CatalogMetadata | null>(null);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState("");
  const [detail, setDetail] = useState<ProgramDetailPayload | null>(null);
  const [detailState, setDetailState] = useState<LoadState>(
    initialPid ? "loading" : "idle",
  );
  const [detailError, setDetailError] = useState("");
  const [savingProgramPid, setSavingProgramPid] = useState<string | null>(null);
  const [addError, setAddError] = useState("");
  const savedCodes = new Set(savedProgramCodes.map((code) => code.toUpperCase()));

  const searchPrograms = useCallback(
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
        const honoursMathematicsScope =
          initialQuery.trim().toUpperCase() === "H-" &&
          cleanQuery.toUpperCase() === "H-";
        const searchParams = new URLSearchParams({
          q: cleanQuery,
          limit: honoursMathematicsScope ? "50" : "12",
        });
        if (honoursMathematicsScope) {
          searchParams.set("faculty", "Faculty of Mathematics");
          searchParams.set("codePrefix", "H-");
        }
        const payload = await requestBrowserJson<ProgramSearchPayload>(
          "/api/catalog/programs?" + searchParams.toString(),
          { signal },
        );
        setResults(payload.programs || []);
        setCatalog(payload.catalog || null);
        setSearchState("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchError(error instanceof Error ? error.message : "Programs could not be loaded.");
        setSearchState("error");
      }
    },
    [initialQuery],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchPrograms(query, controller.signal);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchPrograms]);

  const loadProgram = useCallback(async (pid: string) => {
    setDetailState("loading");
    setDetailError("");
    setAddError("");
    try {
      const payload = await requestBrowserJson<ProgramDetailPayload>(
        "/api/catalog/programs/" + encodeURIComponent(pid),
      );
      setDetail(payload);
      setDetailState("ready");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "The plan could not be loaded.");
      setDetailState("error");
    }
  }, []);

  useEffect(() => {
    if (!initialPid) return;
    const controller = new AbortController();
    void requestBrowserJson<ProgramDetailPayload>(
      "/api/catalog/programs/" + encodeURIComponent(initialPid),
      { signal: controller.signal },
    ).then((payload) => {
      setDetail(payload);
      setDetailState("ready");
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDetailError(error instanceof Error ? error.message : "The plan could not be loaded.");
      setDetailState("error");
    });
    return () => controller.abort();
  }, [initialPid]);

  function openProgram(program: AcademicProgram) {
    updateAcademicDetailUrl("plans", program.pid);
    void loadProgram(program.pid);
  }

  async function addPlan(program: AcademicProgram) {
    if (savingProgramPid || savedCodes.has(program.code.toUpperCase())) return;
    setSavingProgramPid(program.pid);
    setAddError("");
    try {
      const payload = await requestBrowserJson<ProgramMutationPayload>(
        "/api/profile/program",
        {
          method: "POST",
          body: JSON.stringify({ programCode: program.code }),
        },
      );
      if (!payload.success) throw new BrowserApiError("The plan could not be added.");
      setNotice?.(program.title + " was added to your tracked plans.");
      await onAdded?.();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "The plan could not be added.");
    } finally {
      setSavingProgramPid(null);
    }
  }

  return (
    <div className="dashboard-panel guest-explorer-panel">
      <section className="panel-heading">
        <div>
          <span className="eyebrow compact">
            {signedIn ? "Academic calendar browser" : "Read-only calendar explorer"}
          </span>
          <h1>Explore a Waterloo plan</h1>
          <p>
            Search majors, minors, options, and other plans, then inspect the
            requirement information {signedIn ? "from the active calendar." : "without creating an account."}
          </p>
        </div>
      </section>

      <section className="guest-search-layout">
        <div className="program-picker guest-search-card">
          <div className="picker-step">{signedIn ? "Plan search" : "Guest plan search"}</div>
          <h2>Find a plan</h2>
          <p>Search by plan title or calendar code.</p>
          <label htmlFor={searchId}>Plan name</label>
          <div className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              id={searchId}
              type="search"
              role="combobox"
              aria-expanded={searchState === "ready" && results.length > 0}
              aria-controls={searchId + "-results"}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Computer Science, Economics, minor…"
            />
            {searchState === "loading" && <span className="spinner" aria-label="Searching" />}
          </div>
          {catalog && (
            <div className="catalog-context">
              <span>Calendar snapshot</span>
              <strong>{catalog.calendarLabel}</strong>
            </div>
          )}
          <div className="picker-results" id={searchId + "-results"}>
            {searchState === "idle" && (
              <div className="inline-empty">Enter at least two characters to search plans.</div>
            )}
            {searchState === "error" && (
              <div className="inline-error" role="alert">
                <strong>Plan search is unavailable.</strong>
                <span>{searchError}</span>
                <button type="button" onClick={() => void searchPrograms(query)}>Retry</button>
              </div>
            )}
            {searchState === "ready" && results.length === 0 && (
              <div className="inline-empty">No active plan matched “{query.trim()}”.</div>
            )}
            {searchState === "ready" && results.length > 0 && (
              <div className="program-results" role="list" aria-label="Plans">
                {results.map((program) => (
                  <button
                    type="button"
                    className="program-result"
                    key={program.pid}
                    onClick={() => void openProgram(program)}
                  >
                    <div>
                      <strong>{program.title}</strong>
                      <span>
                        {[
                          program.undergraduateCredentialType ||
                            program.graduateCredentialType ||
                            program.programTypeUndergraduate,
                          program.faculty,
                        ].filter(Boolean).join(" · ")}
                      </span>
                      <small>{program.code}</small>
                    </div>
                    <span className="choose-program">
                      {savedCodes.has(program.code.toUpperCase()) ? "Saved" : "View plan"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <section className="guest-detail-card" aria-live="polite">
          {detailState === "idle" && (
            <div className="guest-detail-empty">
              <span className="state-symbol small" aria-hidden="true">⌕</span>
              <h2>Select a plan</h2>
              <p>Its calendar description and requirement groups will appear here.</p>
            </div>
          )}
          {detailState === "loading" && (
            <div className="inline-loading" role="status">
              <span className="spinner" aria-hidden="true" /> Loading plan information…
            </div>
          )}
          {detailState === "error" && (
            <div className="inline-error" role="alert">
              <strong>Plan information is unavailable.</strong>
              <span>{detailError}</span>
            </div>
          )}
          {detailState === "ready" && detail && (
            <>
              <div className="guest-detail-heading">
                <span>{detail.program.code}</span>
                <h2>{detail.program.title}</h2>
                <p>
                  {[
                    detail.program.undergraduateCredentialType ||
                      detail.program.graduateCredentialType ||
                      detail.program.programTypeUndergraduate,
                    detail.program.faculty,
                    detail.program.fieldOfStudy,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              {detail.program.description && (
                <p className="guest-description">{detail.program.description}</p>
              )}
              {signedIn && (
                <div className="course-detail-actions plan-detail-actions">
                  <span className="course-recorded-note">
                    Every tracked plan uses your shared course record.
                  </span>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={
                      savingProgramPid === detail.program.pid ||
                      savedCodes.has(detail.program.code.toUpperCase())
                    }
                    onClick={() => void addPlan(detail.program)}
                  >
                    {savedCodes.has(detail.program.code.toUpperCase())
                      ? "Plan added"
                      : savingProgramPid === detail.program.pid
                        ? "Adding…"
                        : "Add to my plans"}
                  </button>
                </div>
              )}
              {addError && <div className="form-error" role="alert">{addError}</div>}
              <div className="guest-detail-section-heading">
                <h3>Requirement information</h3>
                <span>{detail.requirements.length} groups</span>
              </div>
              <RequirementInformation
                requirements={detail.requirements}
                ownerPid={detail.program.pid}
                emptyMessage="No structured requirement information is available for this plan."
                courseRequirementParseStatusOnly
              />
            </>
          )}
        </section>
      </section>
    </div>
  );
}

const courseStatusLabels: Record<CourseStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  planned: "Planned",
  transfer: "Transfer credit",
};

function CourseEligibilitySummary({
  eligibility,
}: {
  eligibility: CourseEligibilityPayload;
}) {
  const content =
    eligibility.state === "MET"
      ? {
          title: "Course requirements satisfied",
          description:
            "Based on the courses already added to your account, this course’s parsed requirements are satisfied.",
        }
      : eligibility.state === "NOT_MET"
        ? {
            title: "Course requirements not yet satisfied",
            description:
              "Your saved course record does not yet satisfy every parsed requirement for this course.",
          }
        : {
            title: "Requirement status needs review",
            description:
              "The calendar includes requirement text that cannot be evaluated automatically with complete confidence.",
          };

  return (
    <aside
      className={"browser-eligibility eligibility-" + eligibility.state}
      aria-live="polite"
    >
      <div>
        <strong>{content.title}</strong>
        <p>{content.description}</p>
      </div>
      {eligibility.unknownReasons.length > 0 && (
        <ul>
          {eligibility.unknownReasons.slice(0, 3).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function CourseExplorer({
  signedIn = false,
  initialQuery = "",
  initialPid = "",
  initialTerm = "",
  initialStatus = "completed",
  termOptions = [],
  onAdded,
  setNotice,
}: {
  signedIn?: boolean;
  initialQuery?: string;
  initialPid?: string;
  initialTerm?: string;
  initialStatus?: CourseStatus;
  termOptions?: string[];
  onAdded?: () => Promise<void>;
  setNotice?: (message: string) => void;
}) {
  const searchId = useId();
  const termListId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<AcademicCourse[]>([]);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState("");
  const [detail, setDetail] = useState<CourseDetailPayload | null>(null);
  const [detailState, setDetailState] = useState<LoadState>(
    initialPid ? "loading" : "idle",
  );
  const [detailError, setDetailError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [status, setStatus] = useState<CourseStatus>(initialStatus);
  const [term, setTerm] = useState(initialTerm);
  const [grade, setGrade] = useState("");
  const [saving, setSaving] = useState(false);
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
        const payload = await requestBrowserJson<CourseSearchPayload>(
          "/api/catalog/courses?q=" + encodeURIComponent(cleanQuery) + "&limit=12",
          { signal },
        );
        setResults(payload.courses || []);
        setSearchState("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchError(error instanceof Error ? error.message : "Courses could not be loaded.");
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

  const loadCourse = useCallback(async (pid: string) => {
    setDetailState("loading");
    setDetailError("");
    setShowAddForm(false);
    setStatus(initialStatus);
    setTerm(initialTerm);
    setGrade("");
    setFormError("");
    try {
      const payload = await requestBrowserJson<CourseDetailPayload>(
        "/api/catalog/courses/" + encodeURIComponent(pid),
      );
      setDetail(payload);
      setDetailState("ready");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "The course could not be loaded.");
      setDetailState("error");
    }
  }, [initialStatus, initialTerm]);

  useEffect(() => {
    if (!initialPid) return;
    const controller = new AbortController();
    void requestBrowserJson<CourseDetailPayload>(
      "/api/catalog/courses/" + encodeURIComponent(initialPid),
      { signal: controller.signal },
    ).then((payload) => {
      setDetail(payload);
      setDetailState("ready");
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDetailError(error instanceof Error ? error.message : "The course could not be loaded.");
      setDetailState("error");
    });
    return () => controller.abort();
  }, [initialPid]);

  function openCourse(course: AcademicCourse) {
    updateAcademicDetailUrl("courses", course.pid);
    void loadCourse(course.pid);
  }

  async function addCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || saving) return;
    setSaving(true);
    setFormError("");
    try {
      const payload = await requestBrowserJson<CourseMutationPayload>(
        "/api/courses",
        {
          method: "POST",
          body: JSON.stringify({
            courseCode: detail.course.code,
            status,
            term: term.trim() || null,
            grade: grade.trim() || null,
          }),
        },
      );
      if (!payload.success) {
        throw new BrowserApiError("The course could not be added.");
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              viewer: {
                ...current.viewer,
                recordedCount: current.viewer.recordedCount + 1,
              },
            }
          : current,
      );
      setShowAddForm(false);
      setNotice?.(
        detail.course.code + " was added as " + courseStatusLabels[status].toLowerCase() + ".",
      );
      await onAdded?.();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The course could not be added.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dashboard-panel guest-explorer-panel">
      <section className="panel-heading">
        <div>
          <span className="eyebrow compact">
            {signedIn ? "Account-aware calendar browser" : "Read-only calendar explorer"}
          </span>
          <h1>{signedIn ? "Browse Waterloo courses" : "Check course information"}</h1>
          <p>
            {signedIn
              ? "Search the active calendar and check requirements against the courses already added to your account."
              : "Search the active Waterloo calendar and inspect descriptions, units, prerequisites, corequisites, and antirequisites as a guest."}
          </p>
        </div>
      </section>

      <section className="guest-search-layout">
        <div className="catalog-search-card guest-search-card">
          <h2>Find a course</h2>
          <label htmlFor={searchId}>Course code or title</label>
          <div className="search-field large">
            <span aria-hidden="true">⌕</span>
            <input
              id={searchId}
              type="search"
              role="combobox"
              aria-expanded={searchState === "ready" && results.length > 0}
              aria-controls={searchId + "-results"}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="CS 246, algorithms, statistics…"
            />
            {searchState === "loading" && <span className="spinner" aria-label="Searching" />}
          </div>
          <div className="catalog-results-region" id={searchId + "-results"}>
            {searchState === "idle" && (
              <div className="inline-empty">Enter at least two characters to search courses.</div>
            )}
            {searchState === "error" && (
              <div className="inline-error" role="alert">
                <strong>Course search is unavailable.</strong>
                <span>{searchError}</span>
                <button type="button" onClick={() => void searchCourses(query)}>Retry</button>
              </div>
            )}
            {searchState === "ready" && results.length === 0 && (
              <div className="inline-empty">No active course matched “{query.trim()}”.</div>
            )}
            {searchState === "ready" && results.length > 0 && (
              <div className="guest-course-results" role="list" aria-label="Courses">
                {results.map((course) => (
                  <button
                    type="button"
                    className="guest-course-result"
                    key={course.pid}
                    onClick={() => void openCourse(course)}
                  >
                    <span className="course-code-box">{course.code}</span>
                    <span>
                      <strong>{course.title}</strong>
                      <small>
                        {isNonAcademicCourseCode(course.code)
                          ? "Non-academic"
                          : formatUnits(course.credits ?? course.creditMin)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <section className="guest-detail-card" aria-live="polite">
          {detailState === "idle" && (
            <div className="guest-detail-empty">
              <span className="state-symbol small" aria-hidden="true">⌕</span>
              <h2>Select a course</h2>
              <p>Its description and requisite information will appear here.</p>
            </div>
          )}
          {detailState === "loading" && (
            <div className="inline-loading" role="status">
              <span className="spinner" aria-hidden="true" /> Loading course information…
            </div>
          )}
          {detailState === "error" && (
            <div className="inline-error" role="alert">
              <strong>Course information is unavailable.</strong>
              <span>{detailError}</span>
            </div>
          )}
          {detailState === "ready" && detail && (
            <>
              <div className="guest-detail-heading">
                <span>{detail.course.code}</span>
                <h2>{detail.course.title}</h2>
                <p>
                  {[
                    isNonAcademicCourseCode(detail.course.code)
                      ? "Non-academic"
                      : formatUnits(detail.course.credits ?? detail.course.creditMin),
                    detail.course.subjectDescription,
                    detail.course.courseLevel,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              <p className="guest-description">
                {detail.course.description || "No course description is available."}
              </p>
              <div className="external-course-links" aria-label="External course resources">
                <a
                  className="button button-secondary button-compact"
                  href={uwflowCourseUrl(detail.course.code)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span
                    className="external-course-link-icon uwflow"
                    aria-hidden="true"
                  />
                  View on UWFlow
                </a>
                <a
                  className="button button-secondary button-compact"
                  href={redditCourseSearchUrl(detail.course.code)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span
                    className="external-course-link-icon reddit"
                    aria-hidden="true"
                  />
                  Search on Reddit
                </a>
                <a
                  className="button button-secondary button-compact"
                  href={waterlooCourseOutlineUrl(detail.course.code)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View course outline
                </a>
              </div>
              {signedIn && detail.eligibility && (
                <CourseEligibilitySummary eligibility={detail.eligibility} />
              )}
              {signedIn && (
                <div className="course-detail-actions">
                  <div>
                    {detail.viewer.recordedCount > 0 && (
                      <span className="course-recorded-note">
                        Already in your course record {detail.viewer.recordedCount}{" "}
                        {detail.viewer.recordedCount === 1 ? "time" : "times"}.
                      </span>
                    )}
                  </div>
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => {
                      setShowAddForm((visible) => !visible);
                      setFormError("");
                    }}
                  >
                    {showAddForm ? "Close add form" : "Add to my courses"}
                  </button>
                </div>
              )}
              {signedIn && showAddForm && (
                <form className="add-course-form detail-add-course-form" onSubmit={addCourse}>
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
                        {(Object.entries(courseStatusLabels) as Array<[CourseStatus, string]>).map(
                          ([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Term
                      <input
                        value={term}
                        onChange={(event) => setTerm(event.target.value)}
                        list={termListId}
                        placeholder="Fall 2026"
                        required={status === "planned" || status === "in_progress"}
                      />
                      <datalist id={termListId}>
                        {termOptions.map((option) => <option key={option} value={option} />)}
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
                  {formError && <div className="form-error" role="alert">{formError}</div>}
                  <div className="form-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => setShowAddForm(false)}
                    >
                      Cancel
                    </button>
                    <button className="button button-primary" type="submit" disabled={saving}>
                      {saving ? "Adding…" : "Add course"}
                    </button>
                  </div>
                </form>
              )}
              <div className="guest-detail-section-heading">
                <h3>Requisite information</h3>
                <span>{detail.requirements.length} groups</span>
              </div>
              <RequirementInformation
                requirements={detail.requirements}
                ownerPid={detail.course.pid}
                emptyMessage="The calendar does not list prerequisite, corequisite, or antirequisite information for this course."
                evaluations={detail.eligibility?.documents}
              />
            </>
          )}
        </section>
      </section>
    </div>
  );
}

export function SignedInAcademicBrowser({
  dashboard,
  initialQuery,
  initialBrowserTab,
  initialCoursePid,
  initialProgramPid,
  initialTerm,
  initialStatus,
  onAdded,
  setNotice,
}: {
  dashboard: {
    terms: Array<{ label: string }>;
    courses: Array<{ term: string | null }>;
    programs?: Array<{ profile: { programCode: string } }>;
  };
  initialQuery: string;
  initialBrowserTab: GuestTab;
  initialCoursePid: string;
  initialProgramPid: string;
  initialTerm: string;
  initialStatus: CourseStatus;
  onAdded: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<GuestTab>(initialBrowserTab);
  const termOptions = Array.from(
    new Set([
      ...dashboard.terms.map((term) => term.label),
      ...dashboard.courses.map((course) => course.term || ""),
    ]),
  ).filter(Boolean);

  return (
    <div className="signed-browser">
      <section className="browser-view-switcher" aria-label="Academic browser views">
        <div>
          <strong>Academic browser</strong>
          <small>Explore programs or find a course to add.</small>
        </div>
        <div className="segmented-control" role="tablist" aria-label="Browse programs or courses">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "plans"}
            className={activeTab === "plans" ? "active" : ""}
            onClick={() => setActiveTab("plans")}
          >
            Plans
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "courses"}
            className={activeTab === "courses" ? "active" : ""}
            onClick={() => setActiveTab("courses")}
          >
            Courses
          </button>
        </div>
      </section>
      {activeTab === "plans" ? (
        <PlanExplorer
          signedIn
          initialQuery={initialQuery}
          initialPid={initialProgramPid}
          savedProgramCodes={dashboard.programs?.map((program) => program.profile.programCode)}
          onAdded={onAdded}
          setNotice={setNotice}
        />
      ) : (
        <CourseExplorer
          signedIn
          initialQuery={initialQuery}
          initialPid={initialCoursePid}
          initialTerm={initialTerm}
          initialStatus={initialStatus}
          termOptions={termOptions}
          onAdded={onAdded}
          setNotice={setNotice}
        />
      )}
    </div>
  );
}

export function GuestAcademicExplorer({
  initialTab = "plans",
  initialQuery = "",
  initialCoursePid = "",
  initialProgramPid = "",
}: {
  initialTab?: GuestTab;
  initialQuery?: string;
  initialCoursePid?: string;
  initialProgramPid?: string;
}) {
  const [activeTab, setActiveTab] = useState<GuestTab>(initialTab);

  function changeTab(tab: GuestTab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
    window.requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }

  return (
    <div className="app-page guest-app-page">
      <GuestHeader activeTab={activeTab} onTabChange={changeTab} />
      <main id="main-content" className="dashboard-main shell" tabIndex={-1}>
        <GuestNotice />
        {activeTab === "plans" ? (
          <PlanExplorer initialQuery={initialQuery} initialPid={initialProgramPid} />
        ) : (
          <CourseExplorer initialQuery={initialQuery} initialPid={initialCoursePid} />
        )}
      </main>
      <GuestTabs
        activeTab={activeTab}
        onChange={changeTab}
        className="mobile-dashboard-nav guest-mobile-nav"
      />
    </div>
  );
}
