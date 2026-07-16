import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("ships the branded Academic landing page and absolute social-card metadata", async () => {
  const [page, layout, image] = await Promise.all([
    source("app/page.tsx"),
    source("app/layout.tsx"),
    stat(new URL("public/og.png", root)),
  ]);

  assert.match(page, /ROwO Academic/);
  assert.match(page, /Sign in with ROwO/);
  assert.match(page, /not an\s+official University of Waterloo degree audit/i);
  assert.match(layout, /x-forwarded-host/);
  assert.match(layout, /new URL\("\/og\.png", origin\)/);
  assert.ok(image.size > 10_000, "social card should be a real image asset");
});

test("keeps user data and the academic calendar in separate D1 bindings", async () => {
  const [hosting, wrangler, schema] = await Promise.all([
    source(".openai/hosting.json"),
    source("wrangler.jsonc"),
    source("db/schema.ts"),
  ]);

  const hostingConfig = JSON.parse(hosting);
  assert.deepEqual(Object.keys(hostingConfig).sort(), ["d1", "project_id", "r2"]);
  assert.match(hostingConfig.project_id, /^appgprj_[a-z0-9]+$/);
  assert.equal(hostingConfig.d1, "DB");
  assert.equal(hostingConfig.r2, null);
  assert.match(wrangler, /"binding": "DB"/);
  assert.match(wrangler, /"binding": "ACADEMIC_DB"/);
  assert.match(wrangler, /578d593a-d00d-4723-b3de-0659e2388415/);
  assert.match(wrangler, /"ACADEMIC_CATALOG_ID"/);
  assert.match(schema, /catalogId: text\("catalog_id"\)\.notNull\(\)/);
  assert.match(schema, /programPid: text\("program_pid"\)\.notNull\(\)/);
  assert.match(schema, /coursePid: text\("course_pid"\)\.notNull\(\)/);
});

test("includes an initial app-database migration and never stores the SSO token in browser storage", async () => {
  const [migrationFiles, callback] = await Promise.all([
    readdir(new URL("drizzle/", root)),
    source("app/auth/sso-callback/page.tsx"),
  ]);

  assert.ok(
    migrationFiles.some((name) => /^\d+_.+\.sql$/.test(name)),
    "an initial SQL migration must be committed",
  );
  assert.doesNotMatch(callback, /localStorage|sessionStorage/);
  assert.ok(
    callback.indexOf("window.history.replaceState") <
      callback.indexOf('fragmentParams.get("token")'),
    "the callback must scrub the fragment before reading the token",
  );
});
