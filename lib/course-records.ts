/** Courses with these prefixes are required experiences, not academic units. */
export function isNonAcademicCourseCode(courseCode: string): boolean {
  const normalized = courseCode.trim().toUpperCase().replace(/[\s_-]+/g, "");
  return normalized.startsWith("COOP") || normalized.startsWith("PD");
}

/** Return the units that should contribute to academic progress projections. */
export function countedAcademicUnits(
  courseCode: string,
  credits: number | null | undefined,
): number {
  if (isNonAcademicCourseCode(courseCode)) return 0;
  return typeof credits === "number" && Number.isFinite(credits) ? credits : 0;
}
