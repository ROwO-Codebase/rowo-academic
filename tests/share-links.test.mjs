import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/share-links.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const shareLinks = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

const now = Date.parse("2026-07-21T08:00:00.000Z");
const scheduleSnapshot = {
  courses: [
    {
      code: "CS 246",
      title: "Object-Oriented Software Development",
      term: "2026-Fall",
      status: "planned",
      credits: 0.5,
      grade: 88.4,
    },
  ],
};

test("strips grades server-side when a schedule link excludes them", () => {
  const parsed = shareLinks.parseShareCreateInput(
    {
      kind: "schedule",
      includeGrades: false,
      expiresAt: "2026-07-28T23:59:59.999Z",
      snapshot: scheduleSnapshot,
    },
    now,
  );

  assert.equal(parsed.kind, "schedule");
  assert.equal(parsed.includeGrades, false);
  assert.equal("grade" in parsed.snapshot.courses[0], false);
  assert.doesNotMatch(parsed.serializedSnapshot, /88\.4|grade/);
});

test("retains selected grades and validates progress snapshots", () => {
  const schedule = shareLinks.parseShareCreateInput(
    {
      kind: "schedule",
      includeGrades: true,
      expiresAt: null,
      snapshot: scheduleSnapshot,
    },
    now,
  );
  assert.equal(schedule.snapshot.courses[0].grade, 88.4);

  const progress = shareLinks.parseShareCreateInput(
    {
      kind: "progress",
      includeGrades: false,
      expiresAt: "2026-08-01T00:00:00.000Z",
      snapshot: {
        programs: [
          {
            title: "Computer Science",
            code: "BCS",
            credential: "Bachelor of Computer Science",
            requirements: [
              {
                title: "Computer Science core",
                status: "planned",
                evidence: ["CS 136"],
                missing: ["CS 246"],
              },
            ],
          },
        ],
      },
    },
    now,
  );
  assert.equal(progress.kind, "progress");
  assert.equal(progress.snapshot.programs[0].requirements[0].status, "planned");
});

test("rejects expired and excessively long-lived share links", () => {
  assert.throws(
    () => shareLinks.parseShareCreateInput({
      kind: "schedule",
      includeGrades: false,
      expiresAt: "2026-07-20T00:00:00.000Z",
      snapshot: scheduleSnapshot,
    }, now),
    /future/,
  );
  assert.throws(
    () => shareLinks.parseShareCreateInput({
      kind: "schedule",
      includeGrades: false,
      expiresAt: "2028-07-21T00:00:00.000Z",
      snapshot: scheduleSnapshot,
    }, now),
    /within one year/,
  );
});

test("creates unguessable tokens and stores only their SHA-256 digest", async () => {
  const token = shareLinks.createShareToken();
  const hash = await shareLinks.hashShareToken(token);

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(shareLinks.isShareToken(token), true);
  assert.equal(shareLinks.isShareToken("short"), false);
});

