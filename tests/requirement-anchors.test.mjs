import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/requirement-anchors.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const {
  buildRequirementAnchorRegistry,
  buildTrackedProgramAnchorRegistry,
  resolveRequirementReferenceAnchor,
  resolveTrackedProgramReferenceAnchor,
} = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

function root(children = []) {
  return {
    nodeId: "root",
    nodeType: "root",
    text: null,
    children,
  };
}

function requirementReference(overrides) {
  return {
    ordinal: 0,
    targetType: "requirement_node",
    targetPid: "computer-science",
    targetCode: "courseRequirementsNoUnits",
    targetTitle: "List 1",
    credits: null,
    resolutionStatus: "resolved",
    ...overrides,
  };
}

test("resolves document and named-section references within one program", () => {
  const registry = buildRequirementAnchorRegistry("computer-science", [
    {
      documentId: "additional-document",
      sourceField: "additionalConstraints",
      root: root(),
    },
    {
      documentId: "course-document",
      sourceField: "courseRequirementsNoUnits",
      root: root([
        {
          nodeId: "list-one",
          nodeType: "section",
          text: "List 1",
          children: [],
        },
      ]),
    },
  ]);

  const additionalAnchor = resolveRequirementReferenceAnchor(
    registry,
    requirementReference({
      targetCode: "additionalConstraints",
      targetTitle: "additionalConstraints",
    }),
  );
  const listAnchor = resolveRequirementReferenceAnchor(
    registry,
    requirementReference({}),
  );

  assert.equal(
    additionalAnchor,
    registry.documentAnchors.get("additional-document"),
  );
  assert.equal(listAnchor, registry.nodeAnchors.get("list-one"));
  assert.notEqual(additionalAnchor, listAnchor);
});

test("does not create broken anchors for other programs or missing targets", () => {
  const registry = buildRequirementAnchorRegistry("computer-science", [
    {
      documentId: "course-document",
      sourceField: "courseRequirementsNoUnits",
      root: root(),
    },
  ]);

  assert.equal(
    resolveRequirementReferenceAnchor(
      registry,
      requirementReference({ targetPid: "another-program" }),
    ),
    null,
  );
  assert.equal(
    resolveRequirementReferenceAnchor(
      registry,
      requirementReference({ targetTitle: "List 99" }),
    ),
    registry.documentAnchors.get("course-document"),
  );
  assert.equal(
    resolveRequirementReferenceAnchor(
      registry,
      requirementReference({ resolutionStatus: "unresolved" }),
    ),
    null,
  );
});

test("keeps anchors unique across programs", () => {
  const document = {
    documentId: "course-document",
    sourceField: "courseRequirementsNoUnits",
    root: root(),
  };
  const first = buildRequirementAnchorRegistry("program-one", [document]);
  const second = buildRequirementAnchorRegistry("program-two", [document]);

  assert.notEqual(
    first.documentAnchors.get("course-document"),
    second.documentAnchors.get("course-document"),
  );
});

test("resolves tracked program references by pid or program code", () => {
  const registry = buildTrackedProgramAnchorRegistry([
    {
      programPid: "computer-science-bmath-honours",
      programCode: "CS-BMATH-HON",
      anchorId: "program-progress-saved-cs",
    },
  ]);

  const reference = {
    ordinal: 0,
    targetType: "program",
    targetPid: "computer-science-bmath-honours",
    targetCode: "CS-BMATH-HON",
    targetTitle: "Computer Science (Bachelor of Mathematics - Honours)",
    credits: null,
    resolutionStatus: "resolved",
  };

  assert.equal(
    resolveTrackedProgramReferenceAnchor(registry, reference),
    "program-progress-saved-cs",
  );
  assert.equal(
    resolveTrackedProgramReferenceAnchor(registry, {
      ...reference,
      targetPid: "alternate-program-pid",
      targetCode: "cs bmath hon",
    }),
    "program-progress-saved-cs",
  );
});

test("does not anchor untracked or unresolved program references", () => {
  const registry = buildTrackedProgramAnchorRegistry([
    {
      programPid: "computer-science-bmath-honours",
      programCode: "CS-BMATH-HON",
      anchorId: "program-progress-saved-cs",
    },
  ]);
  const reference = {
    ordinal: 0,
    targetType: "program",
    targetPid: "another-program",
    targetCode: "ANOTHER-PROGRAM",
    targetTitle: "Another program",
    credits: null,
    resolutionStatus: "resolved",
  };

  assert.equal(resolveTrackedProgramReferenceAnchor(registry, reference), null);
  assert.equal(
    resolveTrackedProgramReferenceAnchor(registry, {
      ...reference,
      targetPid: "computer-science-bmath-honours",
      resolutionStatus: "unresolved",
    }),
    null,
  );
});
