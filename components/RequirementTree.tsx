"use client";

import type {
  RequirementDisplayReference,
  RequirementNodeManualOverride,
  RequirementNodeManualReference,
  RequirementNodePresentation,
  RequirementReferenceEvaluation,
  TriState,
} from "@/lib/types";
import { shouldHighlightRequirementSubconditions } from "@/lib/requirement-highlights";
import { requirementNodePresentation } from "@/lib/requirement-node-kinds";
import { requirementNodeKey } from "@/lib/requirement-overrides";
import {
  resolveRequirementReferenceAnchor,
  resolveTrackedProgramReferenceAnchor,
  type RequirementAnchorRegistry,
  type TrackedProgramAnchorRegistry,
} from "@/lib/requirement-anchors";
import type { MouseEvent } from "react";

export interface RequirementTreeNodeData {
  nodeId: string | null;
  nodeKey?: string;
  nodeType: string;
  text: string | null;
  logic: string | null;
  minCount: number | null;
  maxCount: number | null;
  presentation?: RequirementNodePresentation;
  references: RequirementDisplayReference[];
  children: RequirementTreeNodeData[];
  state?: TriState;
  automaticState?: TriState;
  plannedCompletion?: boolean;
  reason?: string;
  referenceEvaluations?: RequirementReferenceEvaluation[];
  manualOverride?: RequirementNodeManualOverride;
  containsManualOverride?: boolean;
  containsManualStatusOverride?: boolean;
}

export interface RequirementOverrideTarget {
  nodeKey: string;
  node: RequirementTreeNodeData;
  isRoot: boolean;
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
  onOverrideNode,
}: {
  root: RequirementTreeNodeData;
  evaluation?: RequirementTreeNodeData | null;
  anchorRegistry?: RequirementAnchorRegistry;
  trackedProgramAnchors?: TrackedProgramAnchorRegistry;
  documentId?: string;
  showCourseActivity?: boolean;
  onOverrideNode?: (target: RequirementOverrideTarget) => void;
}) {
  const evaluations = new Map<string, RequirementTreeNodeData>();
  if (evaluation) collectEvaluations(evaluation, evaluations, []);
  const evaluatedRoot = findNodeEvaluation(root, evaluations, []);
  const rootManualOverride = (evaluatedRoot ?? root).manualOverride;
  const documentAnchorId = documentId
    ? anchorRegistry?.documentAnchors.get(documentId)
    : undefined;
  return (
    <div
      className={[
        "requirement-tree",
        documentAnchorId && "requirement-anchor-target",
        rootManualOverride && "is-manually-overridden",
      ].filter(Boolean).join(" ")}
      id={documentAnchorId}
      tabIndex={documentAnchorId ? -1 : undefined}
    >
      <RequirementTreeNode
        node={root}
        evaluations={evaluations}
        anchorRegistry={anchorRegistry}
        trackedProgramAnchors={trackedProgramAnchors}
        showCourseActivity={showCourseActivity}
        onOverrideNode={onOverrideNode}
        highlighted
        isRoot
        path={[]}
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
  onOverrideNode,
  highlighted,
  path,
  isRoot = false,
}: {
  node: RequirementTreeNodeData;
  evaluations: Map<string, RequirementTreeNodeData>;
  anchorRegistry?: RequirementAnchorRegistry;
  trackedProgramAnchors?: TrackedProgramAnchorRegistry;
  showCourseActivity: boolean;
  onOverrideNode?: (target: RequirementOverrideTarget) => void;
  highlighted: boolean;
  path: number[];
  isRoot?: boolean;
}) {
  const evaluated = findNodeEvaluation(node, evaluations, path);
  const effectiveNode = evaluated ?? node;
  const state = evaluated?.state ?? node.state;
  const presentation = evaluated?.presentation ?? node.presentation ??
    requirementNodePresentation({
      node_type: node.nodeType,
      params: {},
      refs: [],
    });
  const manualOverride = effectiveNode.manualOverride;
  const plannedCompletion = showCourseActivity &&
    effectiveNode.plannedCompletion === true;
  const editable = Boolean(onOverrideNode);
  const showState = !isRoot && presentation === "condition" &&
    (highlighted || editable || Boolean(manualOverride)) && state !== undefined;
  const showInformation = !isRoot && presentation === "informational";
  const highlightDescendants = shouldHighlightRequirementSubconditions(
    state,
    highlighted,
  );
  const text = displayNodeText(node, presentation);
  const nodeLabel = text || fallbackNodeLabel(node, presentation, isRoot);
  const stableNodeKey = effectiveNode.nodeKey?.trim() ||
    requirementNodeKey(effectiveNode, path);
  const nodeIcon = nodeIconMeta(presentation, state, plannedCompletion);
  const showNodeIcon = !isRoot && (editable || showState || showInformation);
  const showHeading = !isRoot && (Boolean(text) || editable || Boolean(manualOverride));
  const nodeAnchorId = node.nodeId
    ? anchorRegistry?.nodeAnchors.get(node.nodeId)
    : undefined;
  const content = (
    <>
      {isRoot && manualOverride && (
        <div className="requirement-root-manual-marker">
          <span className="requirement-manual-badge">Manual</span>
        </div>
      )}
      {showHeading && (
        <div className="requirement-node-heading">
          {showNodeIcon && (editable ? (
            <button
              className={[
                "requirement-node-state",
                "requirement-node-override-button",
                nodeIcon.className,
                manualOverride && "is-overridden",
              ].filter(Boolean).join(" ")}
              type="button"
              title={plannedCompletion
                ? "Planned courses will satisfy this requirement."
                : effectiveNode.reason ?? nodeIcon.label}
              aria-label={overrideButtonLabel(nodeLabel, nodeIcon.label, Boolean(manualOverride))}
              aria-haspopup="dialog"
              onClick={() => onOverrideNode?.({
                nodeKey: stableNodeKey,
                node: effectiveNode,
                isRoot,
              })}
            >
              {nodeIcon.symbol}
            </button>
          ) : (
            <span
              className={"requirement-node-state " + nodeIcon.className}
              title={plannedCompletion
                ? "Planned courses will satisfy this requirement."
                : showInformation
                ? "Information"
                : evaluated?.reason ?? node.reason ?? nodeIcon.label}
              aria-label={nodeIcon.label}
            >
              {nodeIcon.symbol}
            </span>
          ))}
          <RequirementNodeText node={node} text={nodeLabel} />
          {manualOverride && (
            <span className="requirement-manual-badge">Manual</span>
          )}
        </div>
      )}
      {manualOverride && (
        <ManualOverrideDetails
          override={manualOverride}
          anchorRegistry={anchorRegistry}
          trackedProgramAnchors={trackedProgramAnchors}
        />
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
                  {referenceEvaluation && (editable ? (
                    <button
                      className={[
                        "requirement-node-state",
                        "requirement-reference-state",
                        "requirement-node-override-button",
                        "state-" + (courseActivity
                          ? "course-activity"
                          : referenceEvaluation.state.toLowerCase()),
                        manualOverride && "is-overridden",
                      ].filter(Boolean).join(" ")}
                      type="button"
                      title={referenceEvaluation.reason}
                      aria-label={overrideButtonLabel(
                        nodeLabel,
                        courseActivity
                          ? courseActivity === "in_progress"
                            ? "Course in progress"
                            : "Course planned"
                          : stateMeta[referenceEvaluation.state].label,
                        Boolean(manualOverride),
                      )}
                      aria-haspopup="dialog"
                      onClick={() => onOverrideNode?.({
                        nodeKey: stableNodeKey,
                        node: effectiveNode,
                        isRoot,
                      })}
                    >
                      {courseActivity ? "✎" : stateMeta[referenceEvaluation.state].symbol}
                    </button>
                  ) : (
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
                  ))}
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
                onOverrideNode={onOverrideNode}
                highlighted={highlightDescendants}
                path={[...path, index]}
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
        className={[
          "requirement-tree-node",
          nodeAnchorId && "requirement-anchor-target",
          manualOverride && "is-manually-overridden",
        ].filter(Boolean).join(" ")}
        id={nodeAnchorId}
        tabIndex={nodeAnchorId ? -1 : undefined}
      >
        {content}
      </div>
    );
}

function ManualOverrideDetails({
  override,
  anchorRegistry,
  trackedProgramAnchors,
}: {
  override: RequirementNodeManualOverride;
  anchorRegistry?: RequirementAnchorRegistry;
  trackedProgramAnchors?: TrackedProgramAnchorRegistry;
}) {
  if (!override.note && override.references.length === 0) return null;

  return (
    <div className="requirement-manual-details">
      {override.note && (
        <p className="requirement-manual-note">
          <strong>Note</strong>
          <span>{override.note}</span>
        </p>
      )}
      {override.references.length > 0 && (
        <div className="requirement-manual-references">
          <span className="requirement-manual-section-label">Added references</span>
          <ul className="requirement-reference-list requirement-manual-reference-list">
            {override.references.map((reference) => (
              <li key={"manual:" + reference.id}>
                <RequirementReferenceLink
                  reference={manualReferenceDisplay(reference)}
                  anchorRegistry={anchorRegistry}
                  trackedProgramAnchors={trackedProgramAnchors}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
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

function fallbackNodeLabel(
  node: RequirementTreeNodeData,
  presentation: RequirementNodePresentation,
  isRoot: boolean,
): string {
  if (isRoot) return "Overall requirement";
  if (presentation === "structural") {
    if (node.logic === "all") return "Requirement group: complete all";
    if (node.logic === "any") return "Requirement group: complete at least one";
    if (node.logic === "at_least" && node.minCount != null) {
      return `Requirement group: complete at least ${node.minCount}`;
    }
    return "Requirement group";
  }
  if (presentation === "informational") return "Requirement information";
  return node.nodeType
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase()) || "Requirement";
}

function nodeIconMeta(
  presentation: RequirementNodePresentation,
  state: TriState | undefined,
  plannedCompletion: boolean,
): { label: string; symbol: string; className: string } {
  if (presentation === "informational") {
    return { label: "Information", symbol: "i", className: "state-info" };
  }
  if (plannedCompletion) {
    return {
      label: "Planned",
      symbol: "✎",
      className: "state-course-activity",
    };
  }
  if (state) {
    return {
      ...stateMeta[state],
      className: "state-" + state.toLowerCase(),
    };
  }
  return { label: "Edit", symbol: "✎", className: "state-editable" };
}

function overrideButtonLabel(
  nodeLabel: string,
  statusLabel: string,
  manuallyOverridden: boolean,
): string {
  return [
    `Edit override for ${nodeLabel.replace(/:\s*$/, "")}.`,
    `Current status: ${statusLabel}.`,
    manuallyOverridden ? "Manual override applied." : "",
  ].filter(Boolean).join(" ");
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
  path: number[],
) {
  output.set("key:" + stableRequirementNodeKey(node, path), node);
  output.set("path:" + path.join("."), node);
  if (node.nodeId) output.set("id:" + node.nodeId, node);
  for (const [index, child] of node.children.entries()) {
    collectEvaluations(child, output, [...path, index]);
  }
}

function findNodeEvaluation(
  node: RequirementTreeNodeData,
  evaluations: Map<string, RequirementTreeNodeData>,
  path: number[],
): RequirementTreeNodeData | undefined {
  return evaluations.get("key:" + stableRequirementNodeKey(node, path)) ??
    (node.nodeId ? evaluations.get("id:" + node.nodeId) : undefined) ??
    evaluations.get("path:" + path.join("."));
}

function stableRequirementNodeKey(
  node: RequirementTreeNodeData,
  path: number[],
): string {
  return node.nodeKey?.trim() || requirementNodeKey(node, path);
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

function manualReferenceDisplay(
  reference: RequirementNodeManualReference,
): RequirementDisplayReference {
  return {
    ordinal: null,
    targetType: reference.targetType,
    targetPid: reference.targetPid,
    targetCode: reference.targetCode,
    targetTitle: reference.targetTitle,
    credits: reference.credits,
    resolutionStatus: reference.resolutionStatus,
  };
}
