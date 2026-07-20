import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/course-links.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { redditCourseSearchUrl, uwflowCourseUrl, waterlooCourseOutlineUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("builds external course links with each service's required code format", () => {
  assert.equal(uwflowCourseUrl("CS 487"), "https://uwflow.com/course/cs487");
  assert.equal(
    redditCourseSearchUrl("CS 135"),
    "https://www.reddit.com/r/uwaterloo/search/?q=cs135",
  );
  assert.equal(
    waterlooCourseOutlineUrl("CS487"),
    "https://outline.uwaterloo.ca/viewer/?q=CS%20487",
  );
  assert.equal(
    waterlooCourseOutlineUrl("ACTSC362"),
    "https://outline.uwaterloo.ca/viewer/?q=ACTSC%20362",
  );
});
