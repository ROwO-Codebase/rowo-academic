import type { RequirementDocument, RequirementNode } from "./types";

/**
 * Build a document-scoped stable key for every AST node, including nodes whose
 * source data does not provide a node id.
 */
export function requirementNodeKey(
  _node: RequirementNode | { nodeId?: string | null },
  path: number[] = [],
): string {
  return path.length === 0 ? "index:root" : "index:" + path.join(".");
}

export function findRequirementNodeByKey(
  root: RequirementNode,
  nodeKey: string,
): RequirementNode | null {
  let match: RequirementNode | null = null;
  const visit = (node: RequirementNode, path: number[]) => {
    if (match) return;
    if (requirementNodeKey(node, path) === nodeKey) {
      match = node;
      return;
    }
    for (const [index, child] of (node.children ?? []).entries()) {
      visit(child, [...path, index]);
    }
  };
  visit(root, []);
  return match;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJsonValue(child)]),
  );
}

/**
 * Version the exact parsed tree, not just its source payload. This prevents an
 * edit from moving to a different node after a parser/schema change.
 */
export async function requirementDocumentSourceKey(
  document: RequirementDocument,
): Promise<string> {
  const serialized = JSON.stringify(canonicalJsonValue(document.ast));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialized),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
  return "ast-sha256:" + hex;
}
