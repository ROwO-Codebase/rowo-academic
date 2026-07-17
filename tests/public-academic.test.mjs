import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/public-academic.ts", import.meta.url),
  "utf8",
);
const nodeKindsSource = await readFile(
  new URL("../lib/requirement-node-kinds.ts", import.meta.url),
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
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText.replace("./requirement-node-kinds", nodeKindsUrl);
const { summarizePublicRequirement } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("publishes the bounded AST hierarchy and resolved detail references", () => {
  const summary = summarizePublicRequirement({
    documentId: "document-1",
    catalogId: "catalog-1",
    ownerType: "courses",
    ownerPid: "cs487-pid",
    ownerVersionId: "cs487-version",
    ownerCode: "CS487",
    requirementKind: "prerequisite",
    sourceField: "prerequisites",
    sourceFormat: "structured_html",
    parseStatus: "parsed",
    evaluability: "machine",
    warnings: [],
    ast: {
      root: {
        node_id: "root",
        node_type: "root",
        logic: "all",
        children: [
          {
            node_id: "group",
            node_type: "group",
            logic: "all",
            text: "Complete all of the following",
            children: [
              {
                node_id: "choice",
                node_type: "course_completed",
                logic: "at_least",
                min_count: 1,
                text: "Must have completed at least 1 of the following:",
                refs: [
                  {
                    ordinal: 0,
                    target_type: "course",
                    target_pid: "cs231-pid",
                    target_code: "CS231",
                    target_title: "Algorithmic Problem Solving",
                    credits: "0.50",
                    resolution_status: "resolved",
                  },
                ],
                children: [],
              },
            ],
          },
        ],
      },
    },
  });

  assert.equal(summary.description, null);
  assert.equal(summary.root.children[0].text, "Complete all of the following");
  const choice = summary.root.children[0].children[0];
  assert.equal(choice.logic, "at_least");
  assert.equal(choice.minCount, 1);
  assert.equal(summary.root.presentation, "structural");
  assert.equal(choice.presentation, "condition");
  assert.deepEqual(choice.references[0], {
    ordinal: 0,
    targetType: "course",
    targetPid: "cs231-pid",
    targetCode: "CS231",
    targetTitle: "Algorithmic Problem Solving",
    credits: "0.50",
    resolutionStatus: "resolved",
  });
});
