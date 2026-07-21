import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/requirements.ts", import.meta.url),
  "utf8",
);
const nodeKindsSource = await readFile(
  new URL("../lib/requirement-node-kinds.ts", import.meta.url),
  "utf8",
);
const overrideKeysSource = await readFile(
  new URL("../lib/requirement-overrides.ts", import.meta.url),
  "utf8",
);
const nodeKindsJavascript = ts.transpileModule(nodeKindsSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const nodeKindsUrl =
  `data:text/javascript;base64,${Buffer.from(nodeKindsJavascript).toString("base64")}`;
const overrideKeysJavascript = ts.transpileModule(overrideKeysSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const overrideKeysUrl =
  `data:text/javascript;base64,${Buffer.from(overrideKeysJavascript).toString("base64")}`;
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
  .replace("./requirement-node-kinds", nodeKindsUrl)
  .replace("./requirement-overrides", overrideKeysUrl);
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

test("marks required course leaves that are in progress or planned", () => {
  const requirement = document(
    node("course_completed", { refs: [reference("CS135")] }),
  );
  const inProgress = evaluateRequirementDocuments(
    [requirement],
    context([
      { coursePid: "cs135-pid", courseCode: "CS135", status: "in_progress" },
    ]),
  );
  const planned = evaluateRequirementDocuments(
    [requirement],
    context([
      { coursePid: "cs135-pid", courseCode: "CS135", status: "planned" },
    ]),
  );
  const completed = evaluateRequirementDocuments(
    [requirement],
    context([
      { coursePid: "cs135-pid", courseCode: "CS135", status: "completed" },
    ]),
  );

  assert.equal(inProgress.state, "NOT_MET");
  assert.equal(
    inProgress.documents[0].root.referenceEvaluations[0].courseActivity,
    "in_progress",
  );
  assert.equal(inProgress.documents[0].root.plannedCompletion, false);
  assert.equal(planned.state, "NOT_MET");
  assert.equal(planned.documents[0].plannedCompletion, true);
  assert.equal(planned.documents[0].root.plannedCompletion, true);
  assert.equal(
    planned.documents[0].root.referenceEvaluations[0].courseActivity,
    "planned",
  );
  assert.equal(
    completed.documents[0].root.referenceEvaluations[0].courseActivity,
    undefined,
  );
});

test("propagates planned completion only through parents the plan will satisfy", () => {
  const plannedCourse = node("course_completed", {
    refs: [reference("CS135")],
  });
  const unmetCourse = node("course_completed", {
    refs: [reference("MATH135")],
  });
  const plannedContext = context([
    { coursePid: "cs135-pid", courseCode: "CS135", status: "planned" },
  ]);
  const anyResult = evaluateRequirementDocuments(
    [document(node("root", {
      logic: "any",
      children: [plannedCourse, unmetCourse],
    }))],
    plannedContext,
  );
  const allResult = evaluateRequirementDocuments(
    [document(node("root", {
      logic: "all",
      children: [plannedCourse, unmetCourse],
    }))],
    plannedContext,
  );

  assert.equal(anyResult.state, "NOT_MET");
  assert.equal(anyResult.documents[0].plannedCompletion, true);
  assert.equal(anyResult.documents[0].root.plannedCompletion, true);
  assert.equal(anyResult.documents[0].root.children[0].plannedCompletion, true);
  assert.equal(anyResult.documents[0].root.children[1].plannedCompletion, false);

  assert.equal(allResult.state, "NOT_MET");
  assert.equal(allResult.documents[0].plannedCompletion, false);
  assert.equal(allResult.documents[0].root.plannedCompletion, false);
  assert.equal(allResult.documents[0].root.children[0].plannedCompletion, true);
});

test("planner eligibility can count a planned prerequisite", () => {
  const prerequisite = document(
    node("course_completed", { refs: [reference("CS135")] }),
  );
  const result = validateCourseEligibility(
    [prerequisite],
    context([
      { coursePid: "cs135-pid", courseCode: "CS135", status: "planned" },
    ]),
    { includePlanned: true },
  );

  assert.equal(result.state, "MET");
  assert.equal(result.eligible, true);
});

test("manual child states propagate through automatic parent logic", () => {
  const root = node("root", {
    node_id: "root-node",
    logic: "all",
    children: [
      node("course_completed", {
        node_id: "completed-child",
        refs: [reference("CS135")],
      }),
      node("course_completed", {
        node_id: "manual-child",
        refs: [reference("MATH135")],
      }),
    ],
  });
  const analysis = evaluateRequirementDocuments(
    [document(root)],
    context([
      { coursePid: "cs135-pid", courseCode: "CS135", status: "completed" },
    ]),
    {
      nodeOverrides: [{
        id: "override-1",
        documentId: "document-1",
        nodeKey: "index:1",
        state: "MET",
        note: "Advisor confirmed equivalent credit.",
        references: [{
          id: "reference-1",
          targetType: "course",
          targetPid: "math135-pid",
          targetVersionId: "math135-version",
          targetCode: "MATH135",
          targetTitle: "Algebra for Honours Mathematics",
          credits: 0.5,
          resolutionStatus: "resolved",
        }],
        updatedAt: 1,
      }],
    },
  );

  const manualChild = analysis.documents[0].root.children[1];
  assert.equal(manualChild.automaticState, "NOT_MET");
  assert.equal(manualChild.state, "MET");
  assert.equal(manualChild.manualOverride.note, "Advisor confirmed equivalent credit.");
  assert.equal(analysis.documents[0].root.state, "MET");
  assert.equal(analysis.documents[0].root.manualOverride, undefined);
  assert.equal(analysis.documents[0].root.containsManualOverride, true);
  assert.deepEqual(collectUnmetCourseCodes(analysis), []);
});

test("a manual parent status wins over final child states", () => {
  const root = node("root", {
    node_id: "manual-root",
    logic: "all",
    children: [
      node("course_completed", {
        node_id: "met-child",
        refs: [reference("CS135")],
      }),
    ],
  });
  const analysis = evaluateRequirementDocuments(
    [document(root)],
    context([
      { coursePid: "cs135-pid", courseCode: "CS135", status: "completed" },
    ]),
    {
      nodeOverrides: [{
        id: "override-root",
        documentId: "document-1",
        nodeKey: "index:root",
        state: "NOT_MET",
        note: null,
        references: [],
        updatedAt: 1,
      }],
    },
  );

  assert.equal(analysis.documents[0].root.automaticState, "MET");
  assert.equal(analysis.documents[0].root.state, "NOT_MET");
  assert.equal(analysis.state, "NOT_MET");
});

test("note-only edits preserve automatic state and support fallback node keys", () => {
  const root = node("course_completed", {
    node_id: undefined,
    tree_path: "requirements.0",
    refs: [reference("CS135")],
  });
  const analysis = evaluateRequirementDocuments(
    [document(root)],
    context([]),
    {
      nodeOverrides: [{
        id: "override-note",
        documentId: "document-1",
        nodeKey: "index:root",
        state: null,
        note: "Waiting for transfer-credit review.",
        references: [],
        updatedAt: 1,
      }],
    },
  );

  assert.equal(analysis.documents[0].root.nodeKey, "index:root");
  assert.equal(analysis.documents[0].root.automaticState, "NOT_MET");
  assert.equal(analysis.documents[0].root.state, "NOT_MET");
  assert.equal(analysis.documents[0].root.containsManualStatusOverride, false);
  assert.equal(analysis.documents[0].root.manualOverride.note, "Waiting for transfer-credit review.");
});

test("a manual status can resolve a partial document", () => {
  const root = node("opaque", {
    node_id: "partial-root",
    text: "Approval of the department",
    evaluability: "manual",
    parse_status: "partial",
  });
  const analysis = evaluateRequirementDocuments(
    [document(root, { parseStatus: "partial", evaluability: "mixed" })],
    context([]),
    {
      nodeOverrides: [{
        id: "override-partial",
        documentId: "document-1",
        nodeKey: "index:root",
        state: "MET",
        note: "Department approval received.",
        references: [],
        updatedAt: 1,
      }],
    },
  );

  assert.equal(analysis.documents[0].root.automaticState, "UNKNOWN");
  assert.equal(analysis.documents[0].state, "MET");
  assert.equal(analysis.state, "MET");
});

test("known condition nodes retain children and use their final states", () => {
  const root = node("course_completed", {
    refs: [reference("CS135")],
    children: [
      node("course_completed", {
        node_id: "nested-course",
        refs: [reference("MATH135")],
      }),
    ],
  });
  const analysis = evaluateRequirementDocuments(
    [document(root)],
    context([
      { coursePid: "cs135-pid", courseCode: "CS135", status: "completed" },
      { coursePid: "math135-pid", courseCode: "MATH135", status: "completed" },
    ]),
    {
      nodeOverrides: [{
        id: "nested-override",
        documentId: "document-1",
        nodeKey: "index:0",
        state: "NOT_MET",
        note: null,
        references: [],
        updatedAt: 1,
      }],
    },
  );

  assert.equal(analysis.documents[0].root.children.length, 1);
  assert.equal(analysis.documents[0].root.children[0].automaticState, "MET");
  assert.equal(analysis.documents[0].root.children[0].state, "NOT_MET");
  assert.equal(analysis.documents[0].root.automaticState, "NOT_MET");
  assert.equal(analysis.state, "NOT_MET");
});

test("descendant edits do not certify unresolved or partial ancestors", () => {
  const unresolvedRoot = node("unsupported_scope", {
    children: [
      node("course_completed", {
        refs: [reference("CS135")],
      }),
    ],
  });
  const override = {
    id: "child-override",
    documentId: "document-1",
    nodeKey: "index:0",
    state: "MET",
    note: null,
    references: [],
    updatedAt: 1,
  };
  const unresolved = evaluateRequirementDocuments(
    [document(unresolvedRoot)],
    context([{ coursePid: "cs135-pid", courseCode: "CS135", status: "completed" }]),
    { nodeOverrides: [override] },
  );
  const partial = evaluateRequirementDocuments(
    [document(node("group", {
      logic: "all",
      children: [node("course_completed", { refs: [reference("CS135")] })],
    }), { parseStatus: "partial", evaluability: "mixed" })],
    context([{ coursePid: "cs135-pid", courseCode: "CS135", status: "completed" }]),
    { nodeOverrides: [override] },
  );

  assert.equal(unresolved.documents[0].root.state, "UNKNOWN");
  assert.equal(partial.documents[0].computedState, "MET");
  assert.equal(partial.documents[0].state, "UNKNOWN");
});

test("duplicate source ids remain independently overridable by path", () => {
  const root = node("group", {
    logic: "all",
    children: [
      node("course_completed", {
        node_id: "duplicate",
        refs: [reference("CS135")],
      }),
      node("course_completed", {
        node_id: "duplicate",
        refs: [reference("MATH135")],
      }),
    ],
  });
  const analysis = evaluateRequirementDocuments(
    [document(root)],
    context([]),
    {
      nodeOverrides: [{
        id: "first-only",
        documentId: "document-1",
        nodeKey: "index:0",
        state: "MET",
        note: null,
        references: [],
        updatedAt: 1,
      }],
    },
  );

  assert.equal(analysis.documents[0].root.children[0].state, "MET");
  assert.equal(analysis.documents[0].root.children[1].state, "NOT_MET");
  assert.equal(analysis.documents[0].root.children[1].manualOverride, undefined);
  assert.equal(analysis.state, "NOT_MET");
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

test("evaluates the real partial 85 percent AST from completed signed-in records", () => {
  const gradeChoice = node("course_completed", {
    evaluability: "partial",
    parse_status: "partial",
    text: "Earned a minimum grade of 85% in at least 1 of the following:",
    logic: "at_least",
    min_count: 1,
    min_grade: 85,
    refs: [reference("CS136"), reference("CS146")],
    numeric_constraints: [
      {
        metric: "grade_percentage",
        qualifier: "minimum",
        numeric_value: 85,
        unit: "percent",
      },
    ],
  });
  const gradeDocument = document(gradeChoice, {
    parseStatus: "partial",
    evaluability: "mixed",
    sourceMatchesCurrentPayload: true,
  });

  const passing = evaluateRequirementDocuments(
    [gradeDocument],
    context([
      {
        coursePid: "cs136-pid",
        courseCode: "CS136",
        status: "completed",
        gradePercent: 85,
      },
    ]),
  );
  const belowMinimum = evaluateRequirementDocuments(
    [gradeDocument],
    context([
      {
        coursePid: "cs136-pid",
        courseCode: "CS136",
        status: "completed",
        gradePercent: 84,
      },
    ]),
  );
  const notCompleted = evaluateRequirementDocuments(
    [gradeDocument],
    context([
      {
        coursePid: "cs136-pid",
        courseCode: "CS136",
        status: "in_progress",
        gradePercent: 95,
      },
    ]),
  );
  const missingGrade = evaluateRequirementDocuments(
    [gradeDocument],
    context([
      {
        coursePid: "cs136-pid",
        courseCode: "CS136",
        status: "completed",
      },
    ]),
  );

  assert.equal(passing.state, "MET");
  assert.equal(passing.documents[0].root.referenceEvaluations[0].state, "MET");
  assert.match(
    passing.documents[0].root.referenceEvaluations[0].reason,
    /completed with 85%/,
  );
  assert.equal(belowMinimum.state, "NOT_MET");
  assert.equal(
    belowMinimum.documents[0].root.referenceEvaluations[0].state,
    "NOT_MET",
  );
  assert.match(
    belowMinimum.documents[0].root.referenceEvaluations[0].reason,
    /84%; 85% is required/,
  );
  assert.equal(notCompleted.state, "NOT_MET");
  assert.match(
    notCompleted.documents[0].root.referenceEvaluations[0].reason,
    /has not been completed/,
  );
  assert.equal(missingGrade.state, "UNKNOWN");
  assert.match(
    missingGrade.documents[0].root.referenceEvaluations[0].reason,
    /grade.*missing/i,
  );
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
  assert.equal(
    result.documents[0].root.referenceEvaluations[0].courseActivity,
    undefined,
  );
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

test("evaluates and preserves the real cascaded course-and-program AST shape", () => {
  const courseChoice = node("course_completed", {
    text: "Must have completed at least 1 of the following:",
    logic: "at_least",
    min_count: 1,
    refs: [
      reference("CS 231", { target_title: "Algorithmic Problem Solving", credits: "0.50" }),
      reference("CS 234", { target_title: "Data Types and Structures", credits: "0.50" }),
      reference("CS 240", { target_title: "Data Structures and Data Management", credits: "0.50" }),
      reference("CS 240E", {
        target_title: "Data Structures and Data Management (Enriched)",
        credits: "0.50",
      }),
    ],
  });
  const mathematicsProgram = node("opaque", {
    text: "Enrolled in an Honours Mathematics program",
  });
  const root = node("root", {
    logic: "all",
    children: [
      node("group", {
        text: "Complete all of the following",
        logic: "all",
        children: [courseChoice, mathematicsProgram],
      }),
    ],
  });
  const withProgram = evaluateRequirementDocuments(
    [document(root)],
    context(
      [
        {
          coursePid: "cs234-pid",
          courseCode: "CS 234",
          status: "completed",
          credits: 0.5,
        },
      ],
      {
        programs: [
          {
            programTitle: "Computer Science (Bachelor of Mathematics - Honours)",
            programCode: "H-Computer Science (BMath)",
            faculty: "Faculty of Mathematics",
            status: "active",
          },
        ],
      },
    ),
  );

  assert.equal(withProgram.state, "MET");
  const evaluatedGroup = withProgram.documents[0].root.children[0];
  assert.equal(evaluatedGroup.text, "Complete all of the following");
  assert.equal(evaluatedGroup.children[0].logic, "at_least");
  assert.equal(evaluatedGroup.children[0].minCount, 1);
  assert.equal(evaluatedGroup.children[0].references[1].targetCode, "CS 234");
  assert.equal(evaluatedGroup.children[1].state, "MET");

  const withoutProgram = evaluateRequirementDocuments(
    [document(root)],
    context([
      {
        coursePid: "cs234-pid",
        courseCode: "CS 234",
        status: "completed",
        credits: 0.5,
      },
    ]),
  );
  assert.equal(withoutProgram.state, "NOT_MET");
});

test("matches both Honours Mathematics phrasings to Faculty of Mathematics H- programs", () => {
  for (const text of [
    "Enrolled in an Honours Mathematics program",
    "Enrolled in Honours Mathematics",
  ]) {
    const requirement = node("opaque", { text });
    const matching = evaluateRequirementDocuments(
      [document(requirement)],
      context([], {
        programs: [{
          programCode: "H-Computer Science (BMath)",
          programTitle: "Computer Science (Bachelor of Mathematics - Honours)",
          faculty: "Faculty of Mathematics",
          status: "active",
        }],
      }),
    );
    assert.equal(matching.state, "MET", text);
  }

  const typedProgramNode = evaluateRequirementDocuments(
    [document(node("program_enrolled", {
      text: "Enrolled in Honours Mathematics",
    }))],
    context([], {
      programs: [{
        programCode: "H-Statistics",
        programTitle: "Statistics (Bachelor of Mathematics - Honours)",
        faculty: "Faculty of Mathematics",
        status: "active",
      }],
    }),
  );
  assert.equal(typedProgramNode.state, "MET");

  const requirement = node("opaque", {
    text: "Enrolled in Honours Mathematics",
  });
  const wrongFaculty = evaluateRequirementDocuments(
    [document(requirement)],
    context([], {
      programs: [{
        programCode: "H-Anthropology",
        programTitle: "Anthropology (Bachelor of Arts - Honours)",
        faculty: "Faculty of Arts",
        status: "active",
      }],
    }),
  );
  const wrongPrefix = evaluateRequirementDocuments(
    [document(requirement)],
    context([], {
      programs: [{
        programCode: "JH-Mathematics",
        programTitle: "Mathematics (Joint Honours)",
        faculty: "Faculty of Mathematics",
        status: "active",
      }],
    }),
  );
  const planned = evaluateRequirementDocuments(
    [document(requirement)],
    context([], {
      programs: [{
        programCode: "H-Statistics",
        programTitle: "Statistics (Bachelor of Mathematics - Honours)",
        faculty: "Faculty of Mathematics",
        status: "planned",
      }],
    }),
  );

  assert.equal(wrongFaculty.state, "NOT_MET");
  assert.equal(wrongPrefix.state, "NOT_MET");
  assert.equal(planned.state, "NOT_MET");
});

test("treats structural and pure informational v2 nodes as neutral", () => {
  const root = node("root", {
    logic: "all",
    children: [
      node("table_row", {
        text: "Key | Description",
        evaluability: "manual",
        parse_status: "partial",
      }),
      node("course_offering_note", {
        text: "Note: EARTH390 is offered after winter exams.",
        evaluability: "partial",
        parse_status: "partial",
      }),
      node("course_completed", { refs: [reference("CS135")] }),
    ],
  });
  const result = evaluateRequirementDocuments(
    [document(root, {
      parseStatus: "partial",
      evaluability: "mixed",
      sourceMatchesCurrentPayload: true,
    })],
    context([{ coursePid: "cs135-pid", courseCode: "CS135", status: "completed" }]),
  );
  assert.equal(result.state, "MET");
  assert.equal(result.documents[0].root.children[0].presentation, "structural");
  assert.equal(result.documents[0].root.children[1].presentation, "informational");
});

test("matches parser-v2 code-only course references by transcript code", () => {
  const root = node("course_completed", {
    refs: [reference("MSCI240", {
      target_pid: null,
      resolution_status: "code_only",
    })],
  });
  const result = evaluateRequirementDocuments(
    [document(root)],
    context([{ courseCode: "MSCI 240", status: "completed" }]),
  );
  assert.equal(result.state, "MET");
});

test("evaluates parser-v2 subject, range, and nested level course selectors", () => {
  const unitPool = node("course_pool", {
    logic: "at_least",
    min_units: 1,
    params: {
      course_selectors_authoritative: true,
      course_selector_logic: "any",
      course_selectors: [{ type: "subject_wildcard", subjects: ["HIST"] }],
    },
  });
  const nestedPool = node("course_pool", {
    logic: "at_least",
    min_count: 5,
    params: {
      course_selectors_authoritative: true,
      course_selector_logic: "any",
      course_selectors: [{ type: "subject_wildcard", subjects: ["AMATH"] }],
      course_selector_constraints: [
        {
          min_count: 3,
          course_selector_logic: "any",
          course_selectors: [
            { type: "course_level", comparison: "one_of", levels: [300, 400] },
          ],
        },
      ],
    },
  });
  const courses = [
    { courseCode: "HIST201", status: "completed", credits: 0.5 },
    { courseCode: "HIST 375", status: "completed", credits: 0.5 },
    { courseCode: "AMATH231", status: "completed", credits: 0.5 },
    { courseCode: "AMATH250", status: "completed", credits: 0.5 },
    { courseCode: "AMATH331", status: "completed", credits: 0.5 },
    { courseCode: "AMATH351", status: "completed", credits: 0.5 },
    { courseCode: "AMATH475", status: "completed", credits: 0.5 },
  ];
  assert.equal(
    evaluateRequirementDocuments([document(unitPool)], context(courses)).state,
    "MET",
  );
  assert.equal(
    evaluateRequirementDocuments([document(nestedPool)], context(courses)).state,
    "MET",
  );

  const rangePool = node("course_pool", {
    logic: "at_least",
    min_count: 1,
    params: {
      course_selectors_authoritative: true,
      course_selectors: [
        { type: "course_range", subject: "HIST", minimum: 300, maximum: 499 },
      ],
    },
  });
  assert.equal(
    evaluateRequirementDocuments([document(rangePool)], context(courses)).state,
    "MET",
  );
});

test("keeps ambiguous parser-v2 selectors unknown", () => {
  const root = node("course_pool", {
    logic: "at_least",
    min_count: 1,
    params: {
      course_selectors_authoritative: false,
      course_selectors: [{ type: "subject_wildcard", subjects: ["CS"] }],
    },
  });
  const result = evaluateRequirementDocuments(
    [document(root)],
    context([{ courseCode: "CS135", status: "completed", credits: 0.5 }]),
  );
  assert.equal(result.state, "UNKNOWN");
});
