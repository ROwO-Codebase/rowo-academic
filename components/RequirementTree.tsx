import type {
  RequirementDisplayReference,
  RequirementNodePresentation,
  RequirementReferenceEvaluation,
  TriState,
} from "@/lib/types";
import { shouldHighlightRequirementSubconditions } from "@/lib/requirement-highlights";
import { requirementNodePresentation } from "@/lib/requirement-node-kinds";

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
}: {
  root: RequirementTreeNodeData;
  evaluation?: RequirementTreeNodeData | null;
}) {
  const evaluations = new Map<string, RequirementTreeNodeData>();
  if (evaluation) collectEvaluations(evaluation, evaluations);
  return (
    <div className="requirement-tree">
      <RequirementTreeNode
        node={root}
        evaluations={evaluations}
        highlighted
        isRoot
      />
    </div>
  );
}

function RequirementTreeNode({
  node,
  evaluations,
  highlighted,
  isRoot = false,
}: {
  node: RequirementTreeNodeData;
  evaluations: Map<string, RequirementTreeNodeData>;
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
            return (
              <li
                key={referenceKey(reference, index)}
                className={referenceEvaluation
                  ? "leaf-state-" + referenceEvaluation.state.toLowerCase()
                  : undefined}
              >
                <div className="requirement-reference-row">
                  {referenceEvaluation && (
                    <span
                      className={
                        "requirement-node-state requirement-reference-state state-" +
                        referenceEvaluation.state.toLowerCase()
                      }
                      title={referenceEvaluation.reason}
                      aria-label={stateMeta[referenceEvaluation.state].label}
                    >
                      {stateMeta[referenceEvaluation.state].symbol}
                    </span>
                  )}
                  <RequirementReferenceLink reference={reference} />
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
                highlighted={highlightDescendants}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return isRoot ? content : <div className="requirement-tree-node">{content}</div>;
}

function RequirementNodeText({
  node,
  text,
}: {
  node: RequirementTreeNodeData;
  text: string;
}) {
  const programQuery = inferredProgramQuery(node);
  if (!programQuery) return <span>{text}</span>;
  return (
    <a
      className="requirement-inferred-link"
      href={"/app?tab=plans&q=" + encodeURIComponent(programQuery)}
      title="Browse matching programs"
    >
      {text}
    </a>
  );
}

function RequirementReferenceLink({
  reference,
}: {
  reference: RequirementDisplayReference;
}) {
  const href = requirementReferenceHref(reference);
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
    <a className="requirement-reference-link" href={href}>{content}</a>
  ) : (
    <span className="requirement-reference-link unresolved">{content}</span>
  );
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

function inferredProgramQuery(node: RequirementTreeNodeData): string | null {
  if (node.nodeType !== "opaque" || node.references.length > 0 || !node.text) {
    return null;
  }
  const match = node.text.match(/^Enrolled in\s+(?:an?\s+)?(.+?)\s+program[.:]?$/i);
  return match?.[1]?.trim() || null;
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
