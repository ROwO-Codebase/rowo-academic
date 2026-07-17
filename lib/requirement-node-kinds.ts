import type {
  RequirementNode,
  RequirementNodePresentation,
} from "./types";

const STRUCTURAL_NODE_TYPES = new Set([
  "root",
  "section",
  "heading",
  "requirement_period",
  "table",
  "table_row",
  "table_column",
  "row",
  "column",
  "columns",
  "legend",
  "legend_item",
  "layout",
]);

const INFORMATIONAL_NODE_TYPES = new Set([
  "course_offering_note",
  "course_pool_definition",
  "named_list_definition",
  "information",
  "informational",
  "note",
  "notice",
  "annotation",
]);

const REQUIREMENT_DEPENDENCY_RELATIONS = new Set([
  "delegates_scope",
  "imports_requirements",
  "list_definition",
  "supplements",
]);

/** Classify a crawler AST node by how its status should be presented. */
export function requirementNodePresentation(
  node: Pick<RequirementNode, "node_type" | "params" | "refs" | "references">,
): RequirementNodePresentation {
  const nodeType = String(node.node_type || "unknown").toLowerCase();
  const declaredRole = String(
    node.params?.presentation ??
      node.params?.semantic_role ??
      node.params?.display_role ??
      "",
  ).toLowerCase();

  if (
    STRUCTURAL_NODE_TYPES.has(nodeType) ||
    ["structural", "layout", "legend"].includes(declaredRole)
  ) {
    return "structural";
  }
  if (
    INFORMATIONAL_NODE_TYPES.has(nodeType) ||
    ["info", "informational", "note"].includes(declaredRole)
  ) {
    return "informational";
  }
  if (nodeType === "cross_reference") {
    const references = Array.isArray(node.refs)
      ? node.refs
      : Array.isArray(node.references)
        ? node.references
        : [];
    const delegatesRequirement = references.some((reference) =>
      reference.target_type === "requirement_node" ||
      REQUIREMENT_DEPENDENCY_RELATIONS.has(String(reference.relation ?? "")));
    return delegatesRequirement ? "condition" : "informational";
  }
  return "condition";
}
