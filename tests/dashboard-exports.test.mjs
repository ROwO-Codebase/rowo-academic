import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/dashboard-exports.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const exportsModule = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

const courses = [
  {
    code: "CS 246",
    title: "Object-Oriented Software Development",
    term: "2026-Fall",
    status: "completed",
    credits: 0.5,
    grade: 84.5,
  },
  {
    code: "CS 341",
    title: "Algorithms",
    term: "2027-Winter",
    status: "planned",
    credits: 0.5,
    grade: null,
  },
];
const generatedAt = new Date("2026-07-21T08:00:00.000Z");

test("creates a valid Excel schedule with optional grade data", () => {
  const withGrades = exportsModule.createCourseScheduleXlsx(
    courses,
    true,
    generatedAt,
  );
  const withoutGrades = exportsModule.createCourseScheduleXlsx(
    courses,
    false,
    generatedAt,
  );
  const withGradesText = Buffer.from(withGrades.bytes).toString("utf8");
  const withoutGradesText = Buffer.from(withoutGrades.bytes).toString("utf8");

  assert.equal(Buffer.from(withGrades.bytes.subarray(0, 2)).toString(), "PK");
  assert.equal(
    withGrades.mimeType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(withGrades.filename, "rowo-course-schedule-20260721.xlsx");
  assert.match(withGradesText, /<t xml:space="preserve">Grade<\/t>/);
  assert.match(withGradesText, /<v>84\.5<\/v>/);
  assert.match(withGradesText, /state="frozen"/);
  assert.match(withGradesText, /<autoFilter ref="A1:F3"/);
  assert.doesNotMatch(withoutGradesText, /<t xml:space="preserve">Grade<\/t>/);
  assert.match(withoutGradesText, /<autoFilter ref="A1:E3"/);
});

test("creates readable schedule PDFs and omits grades when requested", () => {
  const withGrades = exportsModule.createCourseSchedulePdf(courses, true, generatedAt);
  const withoutGrades = exportsModule.createCourseSchedulePdf(
    courses,
    false,
    generatedAt,
  );
  const withGradesText = Buffer.from(withGrades.bytes).toString("latin1");
  const withoutGradesText = Buffer.from(withoutGrades.bytes).toString("latin1");

  assert.match(withGradesText, /^%PDF-1\.4/);
  assert.match(withGradesText, /CS 246 - Object-Oriented Software Development/);
  assert.match(withGradesText, /Grade: 84\.5%/);
  assert.doesNotMatch(withoutGradesText, /Grade:/);
  assert.match(withoutGradesText, /Grades omitted/);
});

test("creates a plan progress checklist PDF with every status", () => {
  const exported = exportsModule.createPlanProgressChecklistPdf(
    [
      {
        code: "BCS",
        title: "Computer Science",
        credential: "Bachelor of Computer Science",
        requirements: [
          {
            title: "Foundational courses",
            status: "met",
            evidence: ["CS 135", "CS 136"],
          },
          {
            title: "Advanced algorithms",
            status: "planned",
            missing: ["CS 341"],
          },
          {
            title: "Breadth requirement",
            status: "not_met",
          },
        ],
      },
    ],
    generatedAt,
  );
  const pdf = Buffer.from(exported.bytes).toString("latin1");

  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\[x\] Foundational courses - Met/);
  assert.match(pdf, /\[ \] Advanced algorithms - On track with plan/);
  assert.match(pdf, /\[ \] Breadth requirement - Not met/);
  assert.match(pdf, /Evidence: CS 135, CS 136/);
  assert.match(pdf, /Still needed: CS 341/);
});

