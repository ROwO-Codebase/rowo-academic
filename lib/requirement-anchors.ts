import type { RequirementDisplayReference } from "./types";

export interface RequirementAnchorNode {
  nodeId: string | null;
  nodeType: string;
  text: string | null;
  children: RequirementAnchorNode[];
}

export interface RequirementAnchorDocument {
  documentId: string;
  sourceField: string;
  root: RequirementAnchorNode | null;
}

export interface RequirementAnchorRegistry {
  ownerPid: string;
  documentAnchors: Map<string, string>;
  nodeAnchors: Map<string, string>;
  referenceTargets: Map<string, string>;
}

export function buildRequirementAnchorRegistry(
  ownerPid: string,
  documents: RequirementAnchorDocument[],
): RequirementAnchorRegistry {
  const documentAnchors = new Map<string, string>();
  const nodeAnchors = new Map<string, string>();
  const referenceTargets = new Map<string, string>();

  for (const document of documents) {
    const documentAnchor = requirementAnchorId(
      "document",
      ownerPid,
      document.documentId,
    );
    documentAnchors.set(document.documentId, documentAnchor);
    referenceTargets.set(
      referenceTargetKey(document.sourceField, null),
      documentAnchor,
    );
    collectNodeAnchors(
      ownerPid,
      document,
      document.root,
      nodeAnchors,
      referenceTargets,
    );
  }

  return {
    ownerPid,
    documentAnchors,
    nodeAnchors,
    referenceTargets,
  };
}

export function resolveRequirementReferenceAnchor(
  registry: RequirementAnchorRegistry | undefined,
  reference: RequirementDisplayReference,
): string | null {
  if (
    !registry ||
    reference.targetType !== "requirement_node" ||
    reference.resolutionStatus !== "resolved" ||
    reference.targetPid !== registry.ownerPid ||
    !reference.targetCode
  ) {
    return null;
  }

  const namedTarget = reference.targetTitle &&
      normalizeAnchorLabel(reference.targetTitle) !==
        normalizeAnchorLabel(reference.targetCode)
    ? registry.referenceTargets.get(
        referenceTargetKey(reference.targetCode, reference.targetTitle),
      )
    : null;

  return namedTarget ??
    registry.referenceTargets.get(referenceTargetKey(reference.targetCode, null)) ??
    null;
}

function collectNodeAnchors(
  ownerPid: string,
  document: RequirementAnchorDocument,
  node: RequirementAnchorNode | null,
  nodeAnchors: Map<string, string>,
  referenceTargets: Map<string, string>,
) {
  if (!node) return;

  if (node.nodeId) {
    const nodeAnchor = requirementAnchorId(
      "node",
      ownerPid,
      document.documentId,
      node.nodeId,
    );
    nodeAnchors.set(node.nodeId, nodeAnchor);

    if (isNamedRequirementTarget(node) && node.text) {
      const targetKey = referenceTargetKey(document.sourceField, node.text);
      if (!referenceTargets.has(targetKey)) {
        referenceTargets.set(targetKey, nodeAnchor);
      }
    }
  }

  for (const child of node.children) {
    collectNodeAnchors(
      ownerPid,
      document,
      child,
      nodeAnchors,
      referenceTargets,
    );
  }
}

function isNamedRequirementTarget(node: RequirementAnchorNode): boolean {
  return node.nodeType === "section" ||
    node.nodeType === "heading" ||
    node.nodeType === "named_list_definition";
}

function referenceTargetKey(sourceField: string, title: string | null): string {
  return [normalizeAnchorLabel(sourceField), normalizeAnchorLabel(title ?? "")]
    .join("\u0000");
}

function normalizeAnchorLabel(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[:.]+$/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function requirementAnchorId(kind: string, ...parts: string[]): string {
  const source = [kind, ...parts].join("\u0000");
  const label = parts
    .map((part) => part.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .join("-")
    .slice(0, 72)
    .toLowerCase();
  return `requirement-${kind}-${label || "target"}-${stableHash(source)}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
