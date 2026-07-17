export function isCourseRequirementSection(
  requirementKind: string | null | undefined,
): boolean {
  const normalized = String(requirementKind ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return normalized === "courserequirement" ||
    normalized === "courserequirements";
}
