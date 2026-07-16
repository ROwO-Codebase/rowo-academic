import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/grade-scale.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { percentageToGpa, weightedGradeAverage } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("converts percentage grades using the requested GPA bands", () => {
  const bands = [
    [100, 4.0],
    [90, 4.0],
    [89.99, 3.9],
    [85, 3.9],
    [84.99, 3.7],
    [80, 3.7],
    [79.99, 3.3],
    [77, 3.3],
    [76.99, 3.0],
    [73, 3.0],
    [72.99, 2.7],
    [70, 2.7],
    [69.99, 2.3],
    [67, 2.3],
    [66.99, 2.0],
    [63, 2.0],
    [62.99, 1.7],
    [60, 1.7],
    [59.99, 1.3],
    [56, 1.3],
  ];

  for (const [percentage, expected] of bands) {
    assert.equal(percentageToGpa(percentage), expected);
  }
  assert.equal(percentageToGpa(55.99), null);
  assert.equal(percentageToGpa(101), null);
});

test("calculates a credit-weighted term average from graded academic courses only", () => {
  assert.equal(
    weightedGradeAverage([
      { grade: 80, credits: 0.5 },
      { grade: 90, credits: 1 },
      { grade: null, credits: 0.5 },
      { grade: 100, credits: 0.5, nonAcademic: true },
    ]),
    86.66666666666667,
  );
  assert.equal(
    weightedGradeAverage([
      { grade: null, credits: 0.5 },
      { credits: 1 },
    ]),
    null,
  );
});
