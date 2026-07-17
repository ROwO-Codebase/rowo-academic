import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/requirement-highlights.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { shouldHighlightRequirementSubconditions } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("only highlights subconditions below a highlighted unmet parent", () => {
  assert.equal(shouldHighlightRequirementSubconditions("NOT_MET", true), true);
  assert.equal(shouldHighlightRequirementSubconditions("UNKNOWN", true), true);
  assert.equal(shouldHighlightRequirementSubconditions("MET", true), false);
  assert.equal(shouldHighlightRequirementSubconditions("NOT_MET", false), false);
  assert.equal(shouldHighlightRequirementSubconditions(undefined, true), false);
});
