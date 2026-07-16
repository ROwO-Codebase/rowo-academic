import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/course-records.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { countedAcademicUnits, isNonAcademicCourseCode } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("classifies COOP and PD course codes as non-academic", () => {
  assert.equal(isNonAcademicCourseCode("COOP 1"), true);
  assert.equal(isNonAcademicCourseCode("coop-2"), true);
  assert.equal(isNonAcademicCourseCode("PD 1"), true);
  assert.equal(isNonAcademicCourseCode("pd10"), true);
  assert.equal(isNonAcademicCourseCode("CS 246"), false);
  assert.equal(isNonAcademicCourseCode("PMATH 340"), false);
});

test("counts only academic courses toward projected units", () => {
  assert.equal(countedAcademicUnits("COOP 1", 0.5), 0);
  assert.equal(countedAcademicUnits("PD 1", 0.5), 0);
  assert.equal(countedAcademicUnits("CS 246", 0.5), 0.5);
  assert.equal(countedAcademicUnits("MATH 135", null), 0);
});
