"use client";

import { useCallback, useEffect, useId, useState } from "react";
import type {
  AcademicCourse,
  AcademicProgram,
  CatalogMetadata,
} from "@/lib/types";
import type { PublicRequirementSummary } from "@/lib/public-academic";
import { Brand } from "./Brand";

type GuestTab = "plans" | "courses";
type LoadState = "idle" | "loading" | "ready" | "error";

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

interface CourseDetailPayload {
  course: AcademicCourse;
  requirements: PublicRequirementSummary[];
  catalog: CatalogMetadata;
}

class GuestApiError extends Error {}

async function requestGuestJson<T>(
  input: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(input, {
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string | { message?: string } }
    | null;
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : payload?.error?.message || "The academic calendar could not be loaded.";
    throw new GuestApiError(message);
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
}: {
  requirements: PublicRequirementSummary[];
  emptyMessage: string;
}) {
  if (requirements.length === 0) {
    return <div className="inline-empty">{emptyMessage}</div>;
  }

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
            <span className={"parse-status parse-" + requirement.parseStatus}>
              {readableLabel(requirement.parseStatus)}
            </span>
          </summary>
          <div className="guest-requirement-body">
            {requirement.description && <p>{requirement.description}</p>}
            {requirement.courseCodes.length > 0 && (
              <div className="course-code-list" aria-label="Referenced courses">
                {requirement.courseCodes.map((code) => (
                  <span key={code}>{code}</span>
                ))}
              </div>
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

function GuestPlanExplorer() {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AcademicProgram[]>([]);
  const [catalog, setCatalog] = useState<CatalogMetadata | null>(null);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState("");
  const [detail, setDetail] = useState<ProgramDetailPayload | null>(null);
  const [detailState, setDetailState] = useState<LoadState>("idle");
  const [detailError, setDetailError] = useState("");

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
        const payload = await requestGuestJson<ProgramSearchPayload>(
          "/api/catalog/programs?q=" + encodeURIComponent(cleanQuery) + "&limit=12",
          signal,
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
    [],
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

  async function openProgram(program: AcademicProgram) {
    setDetailState("loading");
    setDetailError("");
    try {
      const payload = await requestGuestJson<ProgramDetailPayload>(
        "/api/catalog/programs/" + encodeURIComponent(program.pid),
      );
      setDetail(payload);
      setDetailState("ready");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "The plan could not be loaded.");
      setDetailState("error");
    }
  }

  return (
    <div className="dashboard-panel guest-explorer-panel">
      <section className="panel-heading">
        <div>
          <span className="eyebrow compact">Read-only calendar explorer</span>
          <h1>Explore a Waterloo plan</h1>
          <p>
            Search majors, minors, options, and other plans, then inspect the
            requirement information without creating an account.
          </p>
        </div>
      </section>

      <section className="guest-search-layout">
        <div className="program-picker guest-search-card">
          <div className="picker-step">Guest plan search</div>
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
                    <span className="choose-program">View plan</span>
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
              <div className="guest-detail-section-heading">
                <h3>Requirement information</h3>
                <span>{detail.requirements.length} groups</span>
              </div>
              <RequirementInformation
                requirements={detail.requirements}
                emptyMessage="No structured requirement information is available for this plan."
              />
            </>
          )}
        </section>
      </section>
    </div>
  );
}

function GuestCourseExplorer() {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AcademicCourse[]>([]);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState("");
  const [detail, setDetail] = useState<CourseDetailPayload | null>(null);
  const [detailState, setDetailState] = useState<LoadState>("idle");
  const [detailError, setDetailError] = useState("");

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
        const payload = await requestGuestJson<CourseSearchPayload>(
          "/api/catalog/courses?q=" + encodeURIComponent(cleanQuery) + "&limit=12",
          signal,
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

  async function openCourse(course: AcademicCourse) {
    setDetailState("loading");
    setDetailError("");
    try {
      const payload = await requestGuestJson<CourseDetailPayload>(
        "/api/catalog/courses/" + encodeURIComponent(course.pid),
      );
      setDetail(payload);
      setDetailState("ready");
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "The course could not be loaded.");
      setDetailState("error");
    }
  }

  return (
    <div className="dashboard-panel guest-explorer-panel">
      <section className="panel-heading">
        <div>
          <span className="eyebrow compact">Read-only calendar explorer</span>
          <h1>Check course information</h1>
          <p>
            Search the active Waterloo calendar and inspect descriptions,
            units, prerequisites, corequisites, and antirequisites as a guest.
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
                      <small>{formatUnits(course.credits ?? course.creditMin)}</small>
                    </span>
                    <span className="choose-program">View</span>
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
                    formatUnits(detail.course.credits ?? detail.course.creditMin),
                    detail.course.subjectDescription,
                    detail.course.courseLevel,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              <p className="guest-description">
                {detail.course.description || "No course description is available."}
              </p>
              <div className="guest-detail-section-heading">
                <h3>Requisite information</h3>
                <span>{detail.requirements.length} groups</span>
              </div>
              <RequirementInformation
                requirements={detail.requirements}
                emptyMessage="The calendar does not list prerequisite, corequisite, or antirequisite information for this course."
              />
            </>
          )}
        </section>
      </section>
    </div>
  );
}

export function GuestAcademicExplorer() {
  const [activeTab, setActiveTab] = useState<GuestTab>("plans");

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
        {activeTab === "plans" ? <GuestPlanExplorer /> : <GuestCourseExplorer />}
      </main>
      <GuestTabs
        activeTab={activeTab}
        onChange={changeTab}
        className="mobile-dashboard-nav guest-mobile-nav"
      />
    </div>
  );
}
