export interface GradeRecord {
  grade?: number | null;
  credits?: number | null;
  nonAcademic?: boolean;
}

const GPA_BANDS = [
  { minimum: 90, gpa: 4.0 },
  { minimum: 85, gpa: 3.9 },
  { minimum: 80, gpa: 3.7 },
  { minimum: 77, gpa: 3.3 },
  { minimum: 73, gpa: 3.0 },
  { minimum: 70, gpa: 2.7 },
  { minimum: 67, gpa: 2.3 },
  { minimum: 63, gpa: 2.0 },
  { minimum: 60, gpa: 1.7 },
  { minimum: 56, gpa: 1.3 },
] as const;

export function percentageToGpa(percentage: number): number | null {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return null;
  }

  return GPA_BANDS.find((band) => percentage >= band.minimum)?.gpa ?? null;
}

export function weightedGradeAverage(records: GradeRecord[]): number | null {
  const graded = records.filter(
    (record) =>
      !record.nonAcademic &&
      typeof record.grade === "number" &&
      Number.isFinite(record.grade) &&
      record.grade >= 0 &&
      record.grade <= 100 &&
      typeof record.credits === "number" &&
      Number.isFinite(record.credits) &&
      record.credits > 0,
  );
  const credits = graded.reduce((sum, record) => sum + (record.credits ?? 0), 0);
  if (credits === 0) return null;

  return graded.reduce(
    (sum, record) => sum + (record.grade ?? 0) * (record.credits ?? 0),
    0,
  ) / credits;
}
