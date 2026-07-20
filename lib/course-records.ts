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

/** Convert a normalized Waterloo academic term into a sortable value. */
export function academicTermSequence(
  term: string | null | undefined,
): number | null {
  if (!term) return null;
  const match = term.match(/^(\d{4})-(Winter|Spring|Fall)$/);
  if (!match) return null;
  const season = { Winter: 1, Spring: 2, Fall: 3 }[
    match[2] as "Winter" | "Spring" | "Fall"
  ];
  return Number(match[1]) * 10 + season;
}

/** Return true only when both terms are valid and the candidate is earlier. */
export function isEarlierAcademicTerm(
  candidate: string | null | undefined,
  target: string | null | undefined,
): boolean {
  const candidateSequence = academicTermSequence(candidate);
  const targetSequence = academicTermSequence(target);
  return (
    candidateSequence !== null &&
    targetSequence !== null &&
    candidateSequence < targetSequence
  );
}
