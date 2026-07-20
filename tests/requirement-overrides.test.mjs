import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/requirement-overrides.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  findRequirementNodeByKey,
  requirementDocumentSourceKey,
  requirementNodeKey,
} = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("builds unique document-relative keys for every requirement node", () => {
  assert.equal(requirementNodeKey({ node_id: "node-1" }), "index:root");
  assert.equal(
    requirementNodeKey(
      { node_type: "group", tree_path: "root.groups.2" },
      [2],
    ),
    "index:2",
  );
  assert.equal(
    requirementNodeKey({ node_type: "group" }, [1, 3]),
    "index:1.3",
  );
  assert.equal(requirementNodeKey({ node_type: "root" }), "index:root");
});

test("finds anonymous nodes using their document-relative child path", () => {
  const target = { node_type: "course_completed", children: [] };
  const root = {
    node_type: "root",
    children: [
      { node_type: "group", children: [] },
      { node_type: "group", children: [target] },
    ],
  };

  assert.equal(findRequirementNodeByKey(root, "index:1.0"), target);
  assert.equal(findRequirementNodeByKey(root, "index:2"), null);
});

test("versions the exact parsed AST with a collision-resistant digest", async () => {
  const base = {
    ast: {
      root: { node_type: "root", children: [] },
    },
  };
  assert.equal(
    await requirementDocumentSourceKey(base),
    await requirementDocumentSourceKey(structuredClone(base)),
  );
  assert.notEqual(
    await requirementDocumentSourceKey(base),
    await requirementDocumentSourceKey({
      ast: { root: { node_type: "root", children: [{ node_type: "group" }] } },
    }),
  );
  assert.notEqual(
    await requirementDocumentSourceKey({
      ast: { source_sha256: "known", parser_version: 1, root: null },
    }),
    await requirementDocumentSourceKey({
      ast: { source_sha256: "known", parser_version: 2, root: null },
    }),
  );
});

test("duplicate source ids still address distinct nodes", () => {
  const first = { node_type: "group", node_id: "duplicate", children: [] };
  const second = { node_type: "group", node_id: "duplicate", children: [] };
  const root = { node_type: "root", children: [first, second] };

  assert.equal(findRequirementNodeByKey(root, "index:0"), first);
  assert.equal(findRequirementNodeByKey(root, "index:1"), second);
});
