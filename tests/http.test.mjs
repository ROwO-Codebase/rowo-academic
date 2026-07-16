import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/http.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { JsonBodyError, readBoundedJsonObject } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("reads a bounded JSON object", async () => {
  const request = new Request("https://academic.rowo.link/api/example", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ courseCode: "CS246" }),
  });
  assert.deepEqual(await readBoundedJsonObject(request, 1_024), {
    courseCode: "CS246",
  });
});

test("rejects oversized streamed bodies without relying on Content-Length", async () => {
  const request = new Request("https://academic.rowo.link/api/example", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(256) }),
  });
  await assert.rejects(
    readBoundedJsonObject(request, 64),
    (error) => error instanceof JsonBodyError && /too large/i.test(error.message),
  );
});

test("requires an application/json content type", async () => {
  const request = new Request("https://academic.rowo.link/api/example", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  });
  await assert.rejects(
    readBoundedJsonObject(request, 64),
    (error) => error instanceof JsonBodyError && /application\/json/i.test(error.message),
  );
});
