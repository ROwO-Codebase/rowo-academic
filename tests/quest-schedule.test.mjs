import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/quest-schedule.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { parseQuestClassSchedule } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

const sample = `
My Class Schedule
Fall 2026 | Undergraduate | University of Waterloo
CO 456 - Intro Game Theory
Status\tUnits\tGrading\tGrade\tDeadlines
Enrolled
0.50
Numeric Grading Basis
Academic Calendar Deadlines
Class Nbr\tSection\tComponent\tDays & Times\tRoom\tInstructor\tStart/End Date
6128
001
LEC
TTh 1:00PM - 2:20PM
DC 1350
Kanstantsin Pashkovich
2026/09/09 - 2026/12/08
CS 341 - Algorithms
Status\tUnits\tGrading\tGrade\tDeadlines
Enrolled
0.50
Numeric Grading Basis
Academic Calendar Deadlines
Class Nbr\tSection\tComponent\tDays & Times\tRoom\tInstructor\tStart/End Date
6546
002
LEC
TTh 11:30AM - 12:50PM
MC 4045
Rafael Oliveira
2026/09/09 - 2026/12/08
6549
201
TST
M 6:00PM - 7:50PM
TBA
Sylvie Lynne Davies
2026/10/05 - 2026/10/05
M 6:00PM - 7:50PM
TBA
Sylvie Lynne Davies
2026/11/09 - 2026/11/09
6358
101
LAB
F 10:30AM - 11:20AM
MC 4045
To be Announced
2026/09/09 - 2026/12/08
CS 479 - Neural Networks
Status\tUnits\tGrading\tGrade\tDeadlines
Enrolled
0.50
Numeric Grading Basis
Academic Calendar Deadlines
Class Nbr\tSection\tComponent\tDays & Times\tRoom\tInstructor\tStart/End Date
6763
001
LEC
MW 2:30PM - 3:50PM
AL 113
Mohamed Hibat-Allah
2026/09/09 - 2026/12/08
PMATH 347 - Groups & Rings
Status\tUnits\tGrading\tGrade\tDeadlines
Enrolled
0.50
Numeric Grading Basis
Academic Calendar Deadlines
Class Nbr\tSection\tComponent\tDays & Times\tRoom\tInstructor\tStart/End Date
6243
001
LEC
MWF 1:30PM - 2:20PM
AL 113
Faisal Al-Faisal
2026/09/09 - 2026/12/08
Printer Friendly Page`;

test("parses each Quest course once and ignores its meeting rows", () => {
  const result = parseQuestClassSchedule(sample);
  assert.equal(result.term, "2026-Fall");
  assert.deepEqual(
    result.courses.map(({ code, title, status, term, credits }) => ({
      code,
      title,
      status,
      term,
      credits,
    })),
    [
      { code: "CO 456", title: "Intro Game Theory", status: "in_progress", term: "2026-Fall", credits: 0.5 },
      { code: "CS 341", title: "Algorithms", status: "in_progress", term: "2026-Fall", credits: 0.5 },
      { code: "CS 479", title: "Neural Networks", status: "in_progress", term: "2026-Fall", credits: 0.5 },
      { code: "PMATH 347", title: "Groups & Rings", status: "in_progress", term: "2026-Fall", credits: 0.5 },
    ],
  );
  assert.deepEqual(result.warnings, []);
});

test("warns about malformed, dropped, and entirely unparseable schedules", () => {
  const partial = parseQuestClassSchedule(`
Fall 2026 | Undergraduate | University of Waterloo
CO 456 - Intro Game Theory
Status Units Grading Grade Deadlines
Enrolled
0.50
CS ??? - Missing code
Status Units Grading Grade Deadlines
Enrolled
0.50
MATH 137 - Calculus 1
Status Units Grading Grade Deadlines
Dropped
0.50`);
  assert.deepEqual(partial.courses.map((course) => course.code), ["CO 456"]);
  assert.ok(partial.warnings.some((warning) => warning.includes("could not be parsed")));
  assert.ok(partial.warnings.some((warning) => warning.includes("marked Dropped")));

  const empty = parseQuestClassSchedule("My Class Schedule\nList View");
  assert.equal(empty.courses.length, 0);
  assert.ok(empty.warnings.some((warning) => warning.includes("No courses could be parsed")));
});

test("maps a waitlisted course to planned and flags missing units", () => {
  const result = parseQuestClassSchedule(`
Winter 2027 | Undergraduate | University of Waterloo
CS 486 - Introduction to Artificial Intelligence
Status Units Grading Grade Deadlines
Waitlisted
Numeric Grading Basis`);
  assert.equal(result.courses[0].status, "planned");
  assert.equal(result.courses[0].term, "2027-Winter");
  assert.equal(result.courses[0].credits, null);
  assert.ok(result.warnings.some((warning) => warning.includes("units were not found")));
});
