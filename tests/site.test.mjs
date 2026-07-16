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
  assert.match(wrangler, /"binding": "ROWO_AUTH"/);
  assert.match(wrangler, /"service": "rowo-auth"/);
  assert.match(wrangler, /578d593a-d00d-4723-b3de-0659e2388415/);
  assert.match(wrangler, /"ACADEMIC_CATALOG_ID"/);
  assert.match(schema, /catalogId: text\("catalog_id"\)\.notNull\(\)/);
  assert.match(schema, /programPid: text\("program_pid"\)\.notNull\(\)/);
  assert.match(schema, /coursePid: text\("course_pid"\)\.notNull\(\)/);
});

test("validates ROwO sign-in through the Worker service binding", async () => {
  const auth = await source("lib/auth.ts");

  assert.match(auth, /ROWO_AUTH\?: Fetcher/);
  assert.match(auth, /rowoAuth\.fetch\(request\)/);
  assert.match(auth, /await fetch\(request\)/);
  assert.match(auth, /redirect: "manual"/);
  assert.match(auth, /response\.status >= 300 && response\.status < 400/);
});

test("allows guests to inspect plans and courses without exposing personal data writes", async () => {
  const [
    guestExplorer,
    programSearch,
    courseSearch,
    programDetail,
    courseDetail,
    dashboard,
    courseWrites,
  ] = await Promise.all([
    source("components/GuestAcademicExplorer.tsx"),
    source("app/api/catalog/programs/route.ts"),
    source("app/api/catalog/courses/route.ts"),
    source("app/api/catalog/programs/[pid]/route.ts"),
    source("app/api/catalog/courses/[pid]/route.ts"),
    source("app/api/dashboard/route.ts"),
    source("app/api/courses/route.ts"),
  ]);

  assert.match(guestExplorer, /Browsing as a guest/);
  assert.match(guestExplorer, /Explore a Waterloo plan/);
  assert.match(guestExplorer, /Check course information/);
  assert.match(guestExplorer, /Nothing\s+is saved until you sign in with ROwO/);
  assert.doesNotMatch(programSearch, /getLocalSession/);
  assert.doesNotMatch(courseSearch, /getLocalSession/);
  assert.match(courseSearch, /normalizeCourseQuery/);
  assert.match(programDetail, /summarizePublicRequirement/);
  assert.match(courseDetail, /summarizePublicRequirement/);
  assert.match(dashboard, /getLocalSession/);
  assert.match(courseWrites, /getLocalSession/);
});

test("gives signed-in users an account-aware program and course browser", async () => {
  const [browser, dashboard, courseDetail] = await Promise.all([
    source("components/GuestAcademicExplorer.tsx"),
    source("app/app/AcademicDashboard.tsx"),
    source("app/api/catalog/courses/[pid]/route.ts"),
  ]);

  assert.match(browser, /export function SignedInAcademicBrowser/);
  assert.match(browser, /Account-aware calendar browser/);
  assert.match(browser, /Course requirements satisfied/);
  assert.match(browser, /Course requirements not yet satisfied/);
  assert.match(browser, /Add to my courses/);
  assert.match(browser, /method: "POST"/);
  assert.match(dashboard, /\{ id: "catalog", label: "Browse" \}/);
  assert.match(courseDetail, /validateCourseEligibility/);
  assert.match(courseDetail, /courseRecords/);
  assert.match(courseDetail, /private, no-store/);
  assert.match(courseDetail, /recordedCount/);
});

test("renders actual requirement AST nodes as cascaded linked detail trees", async () => {
  const [summary, tree, browser, dashboard, styles] = await Promise.all([
    source("lib/public-academic.ts"),
    source("components/RequirementTree.tsx"),
    source("components/GuestAcademicExplorer.tsx"),
    source("app/app/AcademicDashboard.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(summary, /summarizeRequirementNode/);
  assert.match(summary, /references:/);
  assert.match(tree, /requirement-child-list/);
  assert.match(tree, /tab=courses&course=/);
  assert.match(tree, /tab=plans&plan=/);
  assert.match(browser, /<RequirementTree/);
  assert.match(browser, /initialPid/);
  assert.match(dashboard, /requirement\.root/);
  assert.match(styles, /\.requirement-reference-list/);
});

test("highlights evaluated leaf conditions under unmet AST parents", async () => {
  const [tree, evaluator, styles, courseDetail] = await Promise.all([
    source("components/RequirementTree.tsx"),
    source("lib/requirements.ts"),
    source("app/globals.css"),
    source("app/api/catalog/courses/[pid]/route.ts"),
  ]);

  assert.match(tree, /findReferenceEvaluation/);
  assert.match(tree, /state && state !== "MET"/);
  assert.match(tree, /requirement-leaf-reason/);
  assert.match(evaluator, /referenceEvaluations/);
  assert.match(evaluator, /gradeMinimum != null[\s\S]*?course\.status === "completed"/);
  assert.match(evaluator, /hasVerifiedPartialGradeSemantics/);
  assert.match(courseDetail, /gradePercent: gradePercent\(record\.grade\)/);
  assert.match(styles, /\.leaf-state-not_met/);
});

test("fits long Browse codes and links course details to external resources", async () => {
  const [browser, styles, links] = await Promise.all([
    source("components/GuestAcademicExplorer.tsx"),
    source("app/globals.css"),
    source("lib/course-links.ts"),
  ]);

  assert.doesNotMatch(browser, /<span className="choose-program">View<\/span>/);
  assert.match(browser, /View on UWFlow/);
  assert.match(browser, /View course outline/);
  assert.match(styles, /minmax\(64px, max-content\)/);
  assert.match(styles, /\.external-course-links/);
  assert.match(links, /https:\/\/uwflow\.com\/course\//);
  assert.match(links, /https:\/\/outline\.uwaterloo\.ca\/viewer\/\?q=/);
});

test("tracks multiple plans against one course record and prioritizes overlap", async () => {
  const [browser, dashboardUi, dashboardRoute, programRoute, programDeleteRoute, schema] =
    await Promise.all([
      source("components/GuestAcademicExplorer.tsx"),
      source("app/app/AcademicDashboard.tsx"),
      source("app/api/dashboard/route.ts"),
      source("app/api/profile/program/route.ts"),
      source("app/api/profile/program/[id]/route.ts"),
      source("db/schema.ts"),
    ]);

  assert.match(browser, /Add to my plans/);
  assert.match(browser, /Every tracked plan uses your shared course record/);
  assert.match(dashboardUi, /dashboard\.programs\.map/);
  assert.match(dashboardUi, /Best overlap · \{suggestion\.planCount\} plans/);
  assert.match(dashboardUi, /right\.planCount - left\.planCount/);
  assert.match(dashboardRoute, /programRows\.map\(async \(savedProgram\)/);
  assert.match(dashboardRoute, /recommendationMap/);
  assert.match(dashboardRoute, /right\.programs\.length - left\.programs\.length/);
  assert.match(programRoute, /MAX_SAVED_PROGRAMS/);
  assert.match(programRoute, /currentCalendarPrograms/);
  assert.match(programRoute, /shouldBePrimary/);
  assert.match(programDeleteRoute, /getLocalSession/);
  assert.match(programDeleteRoute, /eq\(userPrograms\.userId, session\.user\.localId\)/);
  assert.match(programDeleteRoute, /nextPrimary/);
  assert.match(dashboardUi, /Remove plan/);

  const courseRecordsStart = schema.indexOf("export const courseRecords");
  const courseRecordsEnd = schema.indexOf("\n);", courseRecordsStart);
  const courseRecordsSchema = schema.slice(courseRecordsStart, courseRecordsEnd);
  assert.doesNotMatch(courseRecordsSchema, /programId|program_id/);
});

test("groups the signed-in course record by academic term", async () => {
  const [dashboard, styles] = await Promise.all([
    source("app/app/AcademicDashboard.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(dashboard, /function courseRecordTermSequence/);
  assert.match(dashboard, /const courseGroups = useMemo/);
  assert.match(dashboard, /courseRecordTermSequence\(right\) - courseRecordTermSequence\(left\)/);
  assert.match(dashboard, /className="course-term-group"/);
  assert.match(dashboard, /Courses recorded for \{group\.term\}/);
  assert.doesNotMatch(dashboard, /<td data-label="Term">\{course\.term\}<\/td>/);
  assert.match(styles, /\.course-term-heading/);
});

test("edits course status, term, and grade from an Overview dialog", async () => {
  const [dashboard, updateRoute, styles] = await Promise.all([
    source("app/app/AcademicDashboard.tsx"),
    source("app/api/courses/[id]/route.ts"),
    source("app/globals.css"),
  ]);

  assert.match(dashboard, /function EditCourseDialog/);
  assert.match(dashboard, /<dialog/);
  assert.match(dashboard, /<CourseStatusBadge status=\{course\.status\}/);
  assert.doesNotMatch(dashboard, /id=\{"status-" \+ course\.id\}/);
  assert.match(dashboard, /aria-label=\{"Edit " \+ course\.code\}/);
  assert.match(dashboard, /status: CourseStatus; term: string \| null; grade: number \| null/);
  assert.match(dashboard, /method: "PATCH"/);
  assert.match(updateRoute, /eq\(courseRecords\.userId, session\.user\.localId\)/);
  assert.match(updateRoute, /A grade can only be recorded for completed or transfer courses/);
  assert.match(styles, /\.course-edit-dialog/);
  assert.match(styles, /\.course-action-buttons/);
});

test("shows graded-only term averages with GPA equivalents in Overview", async () => {
  const [dashboard, grades, styles] = await Promise.all([
    source("app/app/AcademicDashboard.tsx"),
    source("lib/grade-scale.ts"),
    source("app/globals.css"),
  ]);

  assert.match(dashboard, /average: weightedGradeAverage\(courses\)/);
  assert.match(dashboard, /Term average: \{formatAverageWithGpa\(group\.average\)\}/);
  assert.match(dashboard, /course-grade-display/);
  assert.match(grades, /record\.grade !== null|typeof record\.grade === "number"/);
  assert.match(grades, /percentageToGpa/);
  assert.match(styles, /\.course-term-summary/);
});

test("labels COOP and PD courses as non-academic and excludes their units", async () => {
  const [classification, dashboardUi, dashboardRoute, browser] = await Promise.all([
    source("lib/course-records.ts"),
    source("app/app/AcademicDashboard.tsx"),
    source("app/api/dashboard/route.ts"),
    source("components/GuestAcademicExplorer.tsx"),
  ]);

  assert.match(classification, /startsWith\("COOP"\)/);
  assert.match(classification, /startsWith\("PD"\)/);
  assert.match(dashboardRoute, /countedAcademicUnits/);
  assert.match(dashboardUi, /projected academic units/);
  assert.match(dashboardUi, /Non-academic/);
  assert.match(browser, /isNonAcademicCourseCode/);
  assert.match(browser, /Non-academic/);
});

test("keeps the optional grade field free of placeholder text", async () => {
  const [dashboard, browser] = await Promise.all([
    source("app/app/AcademicDashboard.tsx"),
    source("components/GuestAcademicExplorer.tsx"),
  ]);

  assert.doesNotMatch(dashboard, /Completed or transfer only/);
  assert.doesNotMatch(dashboard, /placeholder=\{[\s\S]*?\? "82"/);
  assert.doesNotMatch(browser, /Completed or transfer only/);
  assert.doesNotMatch(browser, /placeholder="82"/);
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
