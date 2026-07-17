import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/requirement-node-kinds.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { requirementNodePresentation } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("classifies parser-v2 structural, informational, and condition nodes", () => {
  for (const nodeType of [
    "root",
    "section",
    "heading",
    "requirement_period",
    "table_row",
    "row",
    "column",
    "legend",
  ]) {
    assert.equal(
      requirementNodePresentation({ node_type: nodeType }),
      "structural",
      nodeType,
    );
  }
  for (const nodeType of [
    "course_offering_note",
    "course_pool_definition",
    "named_list_definition",
  ]) {
    assert.equal(
      requirementNodePresentation({ node_type: nodeType }),
      "informational",
      nodeType,
    );
  }
  assert.equal(
    requirementNodePresentation({ node_type: "student_level" }),
    "condition",
  );
  assert.equal(
    requirementNodePresentation({
      node_type: "cross_reference",
      refs: [{ target_type: "external", relation: "reference" }],
    }),
    "informational",
  );
  assert.equal(
    requirementNodePresentation({
      node_type: "cross_reference",
      refs: [{ target_type: "requirement_node", relation: "delegates_scope" }],
    }),
    "condition",
  );
});
