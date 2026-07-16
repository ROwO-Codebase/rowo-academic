import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/requirements.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const requirements = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

const {
  collectUnmetCourseCodes,
  evaluateRequirementDocuments,
  extractCourseRecommendations,
  normalizeCourseCode,
  validateCourseEligibility,
} = requirements;

function reference(code, overrides = {}) {
  return {
    target_type: "course",
    target_code: code,
    target_pid: `${normalizeCourseCode(code).toLowerCase()}-pid`,
    target_title: `${code} title`,
    resolution_status: "resolved",
    relation: "required",
    ...overrides,
  };
}

function node(nodeType, overrides = {}) {
  return {
    node_id: `${nodeType}-${Math.random()}`,
    node_type: nodeType,
    evaluability: "machine",
    children: [],
    refs: [],
    numeric_constraints: [],
    ...overrides,
  };
}

function document(root, overrides = {}) {
  return {
    documentId: "document-1",
    catalogId: "catalog-1",
    ownerType: "courses",
    ownerPid: "owner-pid",
    ownerVersionId: "owner-version",
    ownerCode: "TEST200",
    requirementKind: "prerequisite",
    sourceField: "prerequisites",
    sourceFormat: "structured_html",
    parseStatus: "parsed",
    evaluability: "machine",
    warnings: [],
    ast: { root },
    ...overrides,
  };
}

function context(courses = [], overrides = {}) {
  return { courses, programs: [], ...overrides };
}

test("normalizes course codes and evaluates nested all rules", () => {
  assert.equal(normalizeCourseCode(" cs-135 "), "CS135");
  const root = node("root", {
    logic: "all",
    children: [
      node("course_completed", { refs: [reference("CS 135")] }),
      node("section", {
        logic: "all",
        children: [node("course_completed", { refs: [reference("MATH 135")] })],
      }),
    ],
  });
  const analysis = evaluateRequirementDocuments(
    [document(root)],
    context([
      {
        coursePid: "cs135-pid",
        courseCode: "CS135",
        status: "completed",
        gradePercent: 82,
        credits: 0.5,
      },
    ]),
  );
  assert.equal(analysis.state, "NOT_MET");
  assert.deepEqual(collectUnmetCourseCodes(analysis), ["MATH135"]);
});

test("a met any alternative safely dominates an unresolved alternative", () => {
  const root = node("root", {
    logic: "any",
    children: [
      node("course_completed", { refs: [reference("CS 135")] }),
      node("course_completed", {
        refs: [reference("MATH 135", { resolution_status: "unresolved" })],
      }),
    ],
  });
  const analysis = evaluateRequirementDocuments(
    [document(root)],
    context([{ coursePid: "cs135-pid", courseCode: "CS135", status: "completed" }]),
  );
  assert.equal(analysis.state, "MET");
});

test("grade-qualified courses distinguish met, failed, and unknown grades", () => {
  const root = node("course_completed", {
    min_grade: 70,
    refs: [reference("CS 135")],
  });
  const high = evaluateRequirementDocuments(
    [document(root)],
    context([{ coursePid: "cs135-pid", courseCode: "CS135", status: "completed", gradePercent: 75 }]),
  );
  const low = evaluateRequirementDocuments(
    [document(root)],
    context([{ coursePid: "cs135-pid", courseCode: "CS135", status: "completed", gradePercent: 65 }]),
  );
  const missing = evaluateRequirementDocuments(
    [document(root)],
    context([{ coursePid: "cs135-pid", courseCode: "CS135", status: "completed" }]),
  );
  assert.equal(high.state, "MET");
  assert.equal(low.state, "NOT_MET");
  assert.equal(missing.state, "UNKNOWN");
});

test("corequisites accept current enrolment while prerequisites do not", () => {
  const enrolled = context([
    { coursePid: "cs135-pid", courseCode: "CS135", status: "enrolled" },
  ]);
  const prerequisite = evaluateRequirementDocuments(
    [document(node("course_completed", { refs: [reference("CS135")] }))],
    enrolled,
  );
  const corequisite = evaluateRequirementDocuments(
    [
      document(
        node("course_completed_or_enrolled", { refs: [reference("CS135")] }),
        { requirementKind: "corequisite", sourceField: "corequisites" },
      ),
    ],
    enrolled,
  );
  assert.equal(prerequisite.state, "NOT_MET");
  assert.equal(corequisite.state, "MET");
});

test("known antirequisite violations make a course ineligible", () => {
  const antirequisite = document(
    node("course_forbidden", {
      logic: "none",
      refs: [reference("MATH 127", { relation: "forbidden" })],
    }),
    {
      requirementKind: "antirequisite",
      sourceField: "antirequisites",
    },
  );
  const result = validateCourseEligibility(
    [antirequisite],
    context([
      { coursePid: "math127-pid", courseCode: "MATH127", status: "completed" },
    ]),
  );
  assert.equal(result.state, "NOT_MET");
  assert.equal(result.eligible, false);
  assert.equal(result.needsReview, false);
});

test("partial documents cannot become definitely met", () => {
  const partial = document(
    node("course_completed", { refs: [reference("CS135")] }),
    { parseStatus: "partial", evaluability: "mixed" },
  );
  const result = validateCourseEligibility(
    [partial],
    context([
      { coursePid: "cs135-pid", courseCode: "CS135", status: "completed" },
    ]),
  );
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.needsReview, true);
});

test("evaluates numeric unit requirements when the transcript has units", () => {
  const root = node("numeric_constraint", {
    numeric_constraints: [
      {
        metric: "academic_units",
        qualifier: "minimum",
        numeric_value: 10,
        unit: "units",
      },
    ],
  });
  const met = evaluateRequirementDocuments(
    [document(root, { ownerType: "programs", requirementKind: "degree_requirements" })],
    context([], { completedUnits: 12 }),
  );
  const unmet = evaluateRequirementDocuments(
    [document(root, { ownerType: "programs", requirementKind: "degree_requirements" })],
    context([], { completedUnits: 8 }),
  );
  assert.equal(met.state, "MET");
  assert.equal(unmet.state, "NOT_MET");
});

test("extracts unresolved positive course work as recommendations", () => {
  const root = node("root", {
    logic: "all",
    children: [
      node("course_completed", { refs: [reference("CS246")] }),
      node("course_pool", {
        logic: "any",
        refs: [reference("CS245"), reference("CS240")],
      }),
      node("course_forbidden", {
        refs: [reference("CS136", { relation: "forbidden" })],
      }),
    ],
  });
  const recommendations = extractCourseRecommendations(
    [document(root, { ownerType: "programs", requirementKind: "course_requirements" })],
    context([]),
  );
  assert.deepEqual(
    recommendations.map((item) => item.courseCode),
    ["CS246", "CS240", "CS245"],
  );
  assert.equal(recommendations[0].isOption, false);
  assert.equal(recommendations[1].isOption, true);
});

test("a catalog-confirmed course with no requisite documents has no restriction", () => {
  const result = validateCourseEligibility([], context([]));
  assert.equal(result.state, "MET");
  assert.equal(result.eligible, true);
});

test("unsupported numeric constraints remain unknown instead of passing", () => {
  const root = node("numeric_constraint", {
    numeric_constraints: [
      {
        metric: "term_count",
        qualifier: "minimum",
        numeric_value: 3,
      },
    ],
  });
  const result = evaluateRequirementDocuments([document(root)], context([]));
  assert.equal(result.state, "UNKNOWN");
});

test("stale serialized rules cannot become definitely met", () => {
  const stale = document(
    node("course_completed", { refs: [reference("CS135")] }),
    { sourceMatchesCurrentPayload: false },
  );
  const result = evaluateRequirementDocuments(
    [stale],
    context([{ coursePid: "cs135-pid", courseCode: "CS135", status: "completed" }]),
  );
  assert.equal(result.state, "UNKNOWN");
});

test("recommendations skip alternatives in an already met choice group", () => {
  const root = node("root", {
    logic: "all",
    children: [
      node("group", {
        logic: "any",
        children: [
          node("course_completed", { refs: [reference("CS135")] }),
          node("course_completed", { refs: [reference("MATH135")] }),
        ],
      }),
      node("course_completed", { refs: [reference("CS246")] }),
    ],
  });
  const recommendations = extractCourseRecommendations(
    [document(root, { ownerType: "programs", requirementKind: "course_requirements" })],
    context([{ coursePid: "cs135-pid", courseCode: "CS135", status: "completed" }]),
  );
  assert.deepEqual(recommendations.map((item) => item.courseCode), ["CS246"]);
});

test("legacy code-only evidence matches only when no conflicting PID exists", () => {
  const root = node("course_completed", { refs: [reference("CS135")] });
  const codeOnly = evaluateRequirementDocuments(
    [document(root)],
    context([{ courseCode: "CS 135", status: "completed" }]),
  );
  const conflicting = evaluateRequirementDocuments(
    [document(root)],
    context([{ coursePid: "different-pid", courseCode: "CS135", status: "completed" }]),
  );
  assert.equal(codeOnly.state, "MET");
  assert.equal(conflicting.state, "NOT_MET");
});
