"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Brand } from "../../../components/Brand";
import type {
  PublicShareSnapshot,
  SharedScheduleCourse,
} from "@/lib/share-links";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; snapshot: PublicShareSnapshot };

const courseStatusLabels = {
  completed: "Completed",
  in_progress: "In progress",
  planned: "Planned",
  transfer: "Transfer credit",
} as const;

const requirementStatusLabels = {
  met: "Met",
  planned: "On track with plan",
  not_met: "Not met",
  unknown: "Needs review",
} as const;

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function termSequence(term: string): number {
  const match = term.match(/^(\d{4})-(Winter|Spring|Fall)$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const season = { Winter: 1, Spring: 2, Fall: 3 }[
    match[2] as "Winter" | "Spring" | "Fall"
  ];
  return Number(match[1]) * 10 + season;
}

function ScheduleView({ snapshot }: { snapshot: Extract<PublicShareSnapshot, { kind: "schedule" }> }) {
  const groups = useMemo(() => {
    const byTerm = new Map<string, SharedScheduleCourse[]>();
    for (const course of snapshot.courses) {
      const courses = byTerm.get(course.term) ?? [];
      courses.push(course);
      byTerm.set(course.term, courses);
    }
    return [...byTerm.entries()]
      .sort(([left], [right]) => termSequence(left) - termSequence(right))
      .map(([term, courses]) => ({
        term,
        courses: [...courses].sort((left, right) => left.code.localeCompare(right.code)),
      }));
  }, [snapshot.courses]);

  if (groups.length === 0) {
    return <div className="shared-plan-empty">No courses were included in this snapshot.</div>;
  }

  return (
    <div className="shared-schedule-groups">
      {groups.map((group) => (
        <section className="shared-plan-card" key={group.term}>
          <div className="shared-plan-card-heading">
            <h2>{group.term}</h2>
            <span>{group.courses.length} {group.courses.length === 1 ? "course" : "courses"}</span>
          </div>
          <div className="shared-schedule-table-wrap">
            <table className="shared-schedule-table">
              <thead>
                <tr>
                  <th scope="col">Course</th>
                  <th scope="col">Title</th>
                  <th scope="col">Status</th>
                  <th scope="col">Units</th>
                  {snapshot.includeGrades && <th scope="col">Grade</th>}
                </tr>
              </thead>
              <tbody>
                {group.courses.map((course, index) => (
                  <tr key={`${course.code}-${index}`}>
                    <th scope="row">{course.code}</th>
                    <td>{course.title}</td>
                    <td>
                      <span className={`shared-status shared-status-${course.status}`}>
                        {courseStatusLabels[course.status]}
                      </span>
                    </td>
                    <td>{course.credits}</td>
                    {snapshot.includeGrades && (
                      <td>
                        {course.grade === null || course.grade === undefined
                          ? "—"
                          : `${course.grade.toFixed(1)}%`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function ProgressView({ snapshot }: { snapshot: Extract<PublicShareSnapshot, { kind: "progress" }> }) {
  if (snapshot.programs.length === 0) {
    return <div className="shared-plan-empty">No tracked plans were included in this snapshot.</div>;
  }
  return (
    <div className="shared-progress-list">
      {snapshot.programs.map((program, programIndex) => {
        const metCount = program.requirements.filter(
          (requirement) => requirement.status === "met",
        ).length;
        return (
          <section className="shared-plan-card shared-progress-card" key={`${program.code}-${programIndex}`}>
            <div className="shared-progress-heading">
              <div>
                <span>{program.code}</span>
                <h2>{program.title}</h2>
                {[program.credential, program.faculty].filter(Boolean).length > 0 && (
                  <p>{[program.credential, program.faculty].filter(Boolean).join(" · ")}</p>
                )}
              </div>
              <strong>{metCount} of {program.requirements.length} met</strong>
            </div>
            <ul className="shared-requirement-list">
              {program.requirements.map((requirement, requirementIndex) => (
                <li key={`${requirement.title}-${requirementIndex}`}>
                  <span
                    className={`shared-check shared-check-${requirement.status}`}
                    aria-hidden="true"
                  >
                    {requirement.status === "met" ? "✓" : ""}
                  </span>
                  <div>
                    <div className="shared-requirement-title">
                      <strong>{requirement.title}</strong>
                      <span className={`shared-requirement-state ${requirement.status}`}>
                        {requirementStatusLabels[requirement.status]}
                      </span>
                    </div>
                    {requirement.description && <p>{requirement.description}</p>}
                    {requirement.evidence.length > 0 && (
                      <small className="shared-evidence">
                        Counted: {requirement.evidence.join(", ")}
                      </small>
                    )}
                    {requirement.missing.length > 0 && (
                      <small className="shared-missing">
                        Still needed: {requirement.missing.join(", ")}
                      </small>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function SharedPlanView({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          "/api/public/shares/" + encodeURIComponent(token),
          { signal: controller.signal, headers: { Accept: "application/json" } },
        );
        const body = await response.json().catch(() => null) as {
          snapshot?: PublicShareSnapshot;
          error?: { message?: string };
        } | null;
        if (!response.ok || !body?.snapshot) {
          throw new Error(
            body?.error?.message || "This shared plan is unavailable.",
          );
        }
        setState({ status: "ready", snapshot: body.snapshot });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error
            ? error.message
            : "This shared plan is unavailable.",
        });
      }
    })();
    return () => controller.abort();
  }, [token]);

  return (
    <div className="shared-page">
      <header className="site-header">
        <div className="site-header-inner">
          <Brand />
          <span className="shared-readonly-badge">Read-only share</span>
        </div>
      </header>
      <main id="main-content" className="shared-plan-main shell">
        {state.status === "loading" && (
          <div className="shared-plan-state" role="status">
            <span className="spinner" aria-hidden="true" />
            <h1>Loading shared plan…</h1>
            <p>Checking that this link is still active.</p>
          </div>
        )}
        {state.status === "error" && (
          <div className="shared-plan-state shared-plan-error">
            <span aria-hidden="true">!</span>
            <h1>Shared plan unavailable</h1>
            <p>{state.message}</p>
            <Link className="button button-primary" href="/">Open ROwO Academic</Link>
          </div>
        )}
        {state.status === "ready" && (
          <>
            <section className="shared-plan-hero">
              <span className="eyebrow compact">Shared by {state.snapshot.ownerName}</span>
              <h1>
                {state.snapshot.kind === "schedule"
                  ? "Course schedule"
                  : "Plan progress"}
              </h1>
              <p>
                Read-only snapshot created {formatDate(state.snapshot.createdAt)}.
                {state.snapshot.expiresAt
                  ? ` This link expires ${formatDate(state.snapshot.expiresAt)}.`
                  : " This link has no automatic expiry."}
              </p>
              {state.snapshot.kind === "schedule" && (
                <span className="shared-grade-disclosure">
                  {state.snapshot.includeGrades ? "Grades included" : "Grades not shared"}
                </span>
              )}
            </section>
            {state.snapshot.kind === "schedule"
              ? <ScheduleView snapshot={state.snapshot} />
              : <ProgressView snapshot={state.snapshot} />}
            <p className="shared-plan-footnote">
              This is a user-created snapshot, not an official University of Waterloo degree audit.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
