import type { TriState } from "./types";

/**
 * Descendant statuses only explain a requirement that is itself still unmet.
 * Once an ancestor is satisfied, failed alternatives below it are no longer
 * blocking conditions and should not be highlighted.
 */
export function shouldHighlightRequirementSubconditions(
  state: TriState | undefined,
  highlighted: boolean,
): boolean {
  return highlighted && state !== undefined && state !== "MET";
}
