export type QuestScheduleCourseStatus =
  | "completed"
  | "in_progress"
  | "planned"
  | "transfer";

export interface ParsedQuestScheduleCourse {
  code: string;
  title: string;
  status: QuestScheduleCourseStatus;
  term: string;
  credits: number | null;
}

export interface ParsedQuestSchedule {
  courses: ParsedQuestScheduleCourse[];
  term: string | null;
  warnings: string[];
}

const COURSE_HEADING = /^([A-Z][A-Z&]{1,9})\s+([0-9]{1,4}[A-Z]?)\s*-\s*(\S.*)$/i;
const COURSE_DETAILS_HEADING = /^Status\s+Units\s+Grading(?:\s+Grade)?\s+Deadlines$/i;

function normalizeLine(value: string): string {
  return value.replace(/\u00a0/g, " ").trim().replace(/[ \t]+/g, " ");
}

function questTerm(lines: string[]): string | null {
  for (const line of lines) {
    const match = line.match(/\b(Fall|Winter|Spring)\s+((?:19|20)\d{2})\s*\|/i);
    if (!match) continue;
    const season = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    return `${match[2]}-${season}`;
  }
  return null;
}

function questStatus(
  lines: string[],
): { status: QuestScheduleCourseStatus; dropped: boolean; warning: string | null } {
  const status = lines.find((line) =>
    /^(Enrolled|Waitlisted|Dropped)$/i.test(line),
  )?.toLowerCase();
  if (status === "waitlisted") {
    return { status: "planned", dropped: false, warning: null };
  }
  if (status === "dropped") {
    return { status: "planned", dropped: true, warning: null };
  }
  if (status === "enrolled") {
    return { status: "in_progress", dropped: false, warning: null };
  }
  return {
    status: "in_progress",
    dropped: false,
    warning: "Its Quest enrollment status was not found, so it was set to In progress.",
  };
}

function questCredits(lines: string[]): number | null {
  const statusIndex = lines.findIndex((line) =>
    /^(Enrolled|Waitlisted|Dropped)$/i.test(line),
  );
  const detailsIndex = lines.findIndex((line) => COURSE_DETAILS_HEADING.test(line));
  const start = statusIndex >= 0 ? statusIndex + 1 : 0;
  const end = detailsIndex > start ? detailsIndex : Math.min(lines.length, start + 6);
  for (const line of lines.slice(start, end)) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(line)) continue;
    const value = Number(line);
    if (Number.isFinite(value) && value >= 0 && value <= 5) return value;
  }
  return null;
}

/**
 * Parse the text copied from Quest's My Class Schedule list view.
 * Meeting rows are intentionally ignored: a profile records one row per course.
 */
export function parseQuestClassSchedule(input: string): ParsedQuestSchedule {
  const lines = input.split(/\r?\n/).map(normalizeLine);
  const term = questTerm(lines);
  const headings = lines.flatMap((line, index) => {
    const match = line.match(COURSE_HEADING);
    return match ? [{ index, match }] : [];
  });
  const headingIndexes = new Set(headings.map((heading) => heading.index));
  const warnings: string[] = [];
  const courses: ParsedQuestScheduleCourse[] = [];

  if (!term) {
    warnings.push(
      "The term could not be read from Quest. Enter a term for each course before importing.",
    );
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const blockEnd = headings[index + 1]?.index ?? lines.length;
    const block = lines.slice(heading.index + 1, blockEnd);
    const code = `${heading.match[1].toUpperCase()} ${heading.match[2].toUpperCase()}`;
    const status = questStatus(block);
    if (status.dropped) {
      warnings.push(`${code} is marked Dropped in Quest and was not included.`);
      continue;
    }
    if (status.warning) warnings.push(`${code}: ${status.warning}`);
    const credits = questCredits(block);
    if (credits === null) {
      warnings.push(
        `${code}: units were not found. The active calendar value will be used unless you enter one.`,
      );
    }
    courses.push({
      code,
      title: heading.match[3].trim(),
      status: status.status,
      term: term ?? "",
      credits,
    });
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (!COURSE_DETAILS_HEADING.test(lines[index])) continue;
    let previous = index - 1;
    while (previous >= 0 && !lines[previous]) previous -= 1;
    if (previous >= 0 && !headingIndexes.has(previous)) {
      warnings.push(
        `A course near “${lines[previous].slice(0, 80)}” could not be parsed. Add it manually before importing.`,
      );
    }
  }

  if (courses.length === 0) {
    warnings.push(
      "No courses could be parsed. Copy Quest's My Class Schedule in List View and paste the complete page text.",
    );
  }

  return { courses, term, warnings: Array.from(new Set(warnings)) };
}
