"use client";

import type {
  RequirementDisplayReference,
  RequirementNodePresentation,
  RequirementReferenceEvaluation,
  TriState,
} from "@/lib/types";
import { shouldHighlightRequirementSubconditions } from "@/lib/requirement-highlights";
import { requirementNodePresentation } from "@/lib/requirement-node-kinds";
import {
  resolveRequirementReferenceAnchor,
  resolveTrackedProgramReferenceAnchor,
  type RequirementAnchorRegistry,
  type TrackedProgramAnchorRegistry,
} from "@/lib/requirement-anchors";
import type { MouseEvent } from "react";

export interface RequirementTreeNodeData {
  nodeId: string | null;
  nodeType: string;
  text: string | null;
  logic: string | null;
  minCount: number | null;
  maxCount: number | null;
  presentation?: RequirementNodePresentation;
  references: RequirementDisplayReference[];
  children: RequirementTreeNodeData[];
  state?: TriState;
  reason?: string;
  referenceEvaluations?: RequirementReferenceEvaluation[];
}

const stateMeta: Record<TriState, { label: string; symbol: string }> = {
  MET: { label: "Met", symbol: "✓" },
  NOT_MET: { label: "Not met", symbol: "!" },
  UNKNOWN: { label: "Needs review", symbol: "?" },
};

export function RequirementTree({
  root,
  evaluation,
  anchorRegistry,
  trackedProgramAnchors,
  documentId,
  showCourseActivity = false,
}: {
  root: RequirementTreeNodeData;
  evaluation?: RequirementTreeNodeData | null;
  anchorRegistry?: RequirementAnchorRegistry;
  trackedProgramAnchors?: TrackedProgramAnchorRegistry;
  documentId?: string;
  showCourseActivity?: boolean;
}) {
  const evaluations = new Map<string, RequirementTreeNodeData>();
  if (evaluation) collectEvaluations(evaluation, evaluations);
  const documentAnchorId = documentId
    ? anchorRegistry?.documentAnchors.get(documentId)
    : undefined;
  return (
    <div
      className={documentAnchorId
        ? "requirement-tree requirement-anchor-target"
        : "requirement-tree"}
      id={documentAnchorId}
      tabIndex={documentAnchorId ? -1 : undefined}
    >
      <RequirementTreeNode
        node={root}
        evaluations={evaluations}
        anchorRegistry={anchorRegistry}
        trackedProgramAnchors={trackedProgramAnchors}
        showCourseActivity={showCourseActivity}
        highlighted
        isRoot
      />
    </div>
  );
}

function RequirementTreeNode({
  node,
  evaluations,
  anchorRegistry,
  trackedProgramAnchors,
  showCourseActivity,
  highlighted,
  isRoot = false,
}: {
  node: RequirementTreeNodeData;
  evaluations: Map<string, RequirementTreeNodeData>;
  anchorRegistry?: RequirementAnchorRegistry;
  trackedProgramAnchors?: TrackedProgramAnchorRegistry;
  showCourseActivity: boolean;
  highlighted: boolean;
  isRoot?: boolean;
}) {
  const evaluated = node.nodeId ? evaluations.get(node.nodeId) : undefined;
  const state = evaluated?.state ?? node.state;
  const presentation = evaluated?.presentation ?? node.presentation ??
    requirementNodePresentation({
      node_type: node.nodeType,
      params: {},
      refs: [],
    });
  const showState = !isRoot && presentation === "condition" && highlighted &&
    state !== undefined;
  const showInformation = !isRoot && presentation === "informational";
  const highlightDescendants = shouldHighlightRequirementSubconditions(
    state,
    highlighted,
  );
  const text = displayNodeText(node, presentation);
  const nodeAnchorId = node.nodeId
    ? anchorRegistry?.nodeAnchors.get(node.nodeId)
    : undefined;
  const content = (
    <>
      {!isRoot && text && (
        <div className="requirement-node-heading">
          {showInformation && (
            <span
              className="requirement-node-state state-info"
              title="Information"
              aria-label="Information"
            >
              i
            </span>
          )}
          {showState && (
            <span
              className={"requirement-node-state state-" + state.toLowerCase()}
              title={evaluated?.reason ?? node.reason ?? stateMeta[state].label}
              aria-label={stateMeta[state].label}
            >
              {stateMeta[state].symbol}
            </span>
          )}
          <RequirementNodeText node={node} text={text} />
        </div>
      )}
      {node.references.length > 0 && (
        <ul className="requirement-reference-list">
          {node.references.map((reference, index) => {
            const referenceEvaluation = highlightDescendants
              ? findReferenceEvaluation(evaluated ?? node, reference, index)
              : undefined;
            const courseActivity = showCourseActivity &&
                referenceEvaluation?.state !== "MET"
              ? referenceEvaluation?.courseActivity
              : undefined;
            const leafState = courseActivity ??
              referenceEvaluation?.state.toLowerCase();
            return (
              <li
                key={referenceKey(reference, index)}
                className={leafState
                  ? "leaf-state-" + leafState
                  : undefined}
              >
                <div className="requirement-reference-row">
                  {referenceEvaluation && (
                    <span
                      className={
                        "requirement-node-state requirement-reference-state state-" +
                        (courseActivity ? "course-activity" : referenceEvaluation.state.toLowerCase())
                      }
                      title={referenceEvaluation.reason}
                      aria-label={courseActivity
                        ? courseActivity === "in_progress"
                          ? "Course in progress"
                          : "Course planned"
                        : stateMeta[referenceEvaluation.state].label}
                    >
                      {courseActivity ? "✎" : stateMeta[referenceEvaluation.state].symbol}
                    </span>
                  )}
                  <RequirementReferenceLink
                    reference={reference}
                    anchorRegistry={anchorRegistry}
                    trackedProgramAnchors={trackedProgramAnchors}
                  />
                </div>
                {referenceEvaluation && (
                  <small className="requirement-leaf-reason">
                    {referenceEvaluation.reason}
                  </small>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {node.children.length > 0 && (
        <ul className={isRoot ? "requirement-child-list root-children" : "requirement-child-list"}>
          {node.children.map((child, index) => (
            <li key={child.nodeId ?? child.nodeType + "-" + index}>
              <RequirementTreeNode
                node={child}
                evaluations={evaluations}
                anchorRegistry={anchorRegistry}
                trackedProgramAnchors={trackedProgramAnchors}
                showCourseActivity={showCourseActivity}
                highlighted={highlightDescendants}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return isRoot
    ? content
    : (
      <div
        className={nodeAnchorId
          ? "requirement-tree-node requirement-anchor-target"
          : "requirement-tree-node"}
        id={nodeAnchorId}
        tabIndex={nodeAnchorId ? -1 : undefined}
      >
        {content}
      </div>
    );
}

function RequirementNodeText({
  node,
  text,
}: {
  node: RequirementTreeNodeData;
  text: string;
}) {
  const programHref = inferredProgramHref(node);
  if (!programHref) return <span>{text}</span>;
  return (
    <a
      className="requirement-inferred-link"
      href={programHref}
      title="Browse matching programs"
    >
      {text}
    </a>
  );
}

function RequirementReferenceLink({
  reference,
  anchorRegistry,
  trackedProgramAnchors,
}: {
  reference: RequirementDisplayReference;
  anchorRegistry?: RequirementAnchorRegistry;
  trackedProgramAnchors?: TrackedProgramAnchorRegistry;
}) {
  const anchorId = resolveRequirementReferenceAnchor(anchorRegistry, reference) ??
    resolveTrackedProgramReferenceAnchor(trackedProgramAnchors, reference);
  const href = anchorId
    ? "#" + encodeURIComponent(anchorId)
    : requirementReferenceHref(reference);
  const content = reference.targetType === "course" ? (
    <>
      <strong>{reference.targetCode ?? reference.targetTitle ?? "Course"}</strong>
      {reference.targetTitle && reference.targetCode && (
        <span>{" - " + reference.targetTitle}</span>
      )}
      {reference.credits != null && (
        <small>{" (" + String(reference.credits) + ")"}</small>
      )}
    </>
  ) : (
    <>
      <strong>{reference.targetTitle ?? reference.targetCode ?? "Program"}</strong>
      {reference.targetTitle && reference.targetCode && (
        <small>{reference.targetCode}</small>
      )}
    </>
  );

  return href ? (
    <a
      className="requirement-reference-link"
      href={href}
      onClick={anchorId
        ? (event) => focusRequirementAnchor(event, anchorId)
        : undefined}
    >
      {content}
    </a>
  ) : (
    <span className="requirement-reference-link unresolved">{content}</span>
  );
}

function focusRequirementAnchor(
  event: MouseEvent<HTMLAnchorElement>,
  anchorId: string,
) {
  if (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }

  const target = document.getElementById(anchorId);
  if (!target) return;
  event.preventDefault();

  let ancestor = target.parentElement;
  while (ancestor) {
    if (ancestor.tagName === "DETAILS") {
      (ancestor as HTMLDetailsElement).open = true;
    }
    ancestor = ancestor.parentElement;
  }

  const hash = "#" + encodeURIComponent(anchorId);
  if (window.location.hash === hash) {
    window.history.replaceState(null, "", hash);
  } else {
    window.history.pushState(null, "", hash);
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "start",
  });
}

function requirementReferenceHref(
  reference: RequirementDisplayReference,
): string | null {
  if (!reference.targetPid || reference.resolutionStatus !== "resolved") return null;
  if (reference.targetType === "course") {
    return "/app?tab=courses&course=" + encodeURIComponent(reference.targetPid);
  }
  if (reference.targetType === "program") {
    return "/app?tab=plans&plan=" + encodeURIComponent(reference.targetPid);
  }
  return null;
}

function displayNodeText(
  node: RequirementTreeNodeData,
  presentation: RequirementNodePresentation,
): string {
  if (node.nodeType === "program_enrolled" && node.references.length > 1) {
    const count = node.minCount ?? 1;
    return `Enrolled in at least ${count} of the following programs:`;
  }
  if (node.nodeType === "program_forbidden" && node.references.length > 0) {
    return "Must not be enrolled in any of the following programs:";
  }
  if (node.text) {
    if (node.children.length === 0 && node.references.length === 0) return node.text;
    return /:\s*$/.test(node.text) ? node.text : node.text + ":";
  }
  if (presentation === "structural") return "";
  if (node.logic === "all") return "Complete all of the following:";
  if (node.logic === "at_least" && node.minCount != null) {
    return `Complete at least ${node.minCount} of the following:`;
  }
  if (node.logic === "any") return "Complete at least 1 of the following:";
  return "Requirement:";
}

function inferredProgramHref(node: RequirementTreeNodeData): string | null {
  if (node.references.length > 0 || !node.text) {
    return null;
  }
  if (
    /^Enrolled in\s+(?:an?\s+)?Honours Mathematics(?:\s+program)?[.:]?$/i
      .test(node.text.trim())
  ) {
    return "/app?tab=plans&q=H-&faculty=Faculty%20of%20Mathematics&codePrefix=H-";
  }
  if (node.nodeType !== "opaque") return null;
  const match = node.text.match(/^Enrolled in\s+(?:an?\s+)?(.+?)\s+program[.:]?$/i);
  const query = match?.[1]?.trim();
  return query
    ? "/app?tab=plans&q=" + encodeURIComponent(query)
    : null;
}

function collectEvaluations(
  node: RequirementTreeNodeData,
  output: Map<string, RequirementTreeNodeData>,
) {
  if (node.nodeId) output.set(node.nodeId, node);
  for (const child of node.children) collectEvaluations(child, output);
}

function referenceKey(reference: RequirementDisplayReference, index: number) {
  return [
    reference.targetType,
    reference.targetPid,
    reference.targetCode,
    reference.ordinal ?? index,
  ].join(":");
}

function findReferenceEvaluation(
  node: RequirementTreeNodeData,
  reference: RequirementDisplayReference,
  index: number,
): RequirementReferenceEvaluation | undefined {
  const evaluations = node.referenceEvaluations ?? [];
  return evaluations.find((evaluation) =>
    Boolean(reference.targetPid && evaluation.targetPid === reference.targetPid) ||
    Boolean(reference.targetCode && evaluation.targetCode === reference.targetCode) ||
    (reference.ordinal != null && evaluation.ordinal === reference.ordinal)) ??
    evaluations[index];
}
