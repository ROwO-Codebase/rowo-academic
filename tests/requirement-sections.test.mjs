import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/requirement-sections.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { isCourseRequirementSection } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("recognizes only course-requirement section kinds", () => {
  assert.equal(isCourseRequirementSection("course_requirements"), true);
  assert.equal(isCourseRequirementSection("Course Requirement"), true);
  assert.equal(isCourseRequirementSection("additional_constraints"), false);
  assert.equal(isCourseRequirementSection("cooperative_requirements"), false);
  assert.equal(isCourseRequirementSection("degree_requirements"), false);
});
