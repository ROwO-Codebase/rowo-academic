import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import {
  courseRecords,
  requirementNodeOverrideReferences,
  requirementNodeOverrides,
  userPrograms,
} from "@/db/schema";
import {
  AcademicDataError,
  getCoursesByCodes,
  getCatalogMetadata,
  getProgramRequirementDocumentsByPids,
} from "@/lib/academic";
import { getLocalSession } from "@/lib/auth";
import {
  countedAcademicUnits,
  isNonAcademicCourseCode,
} from "@/lib/course-records";
import { requirementDocumentSourceKey } from "@/lib/requirement-overrides";
import {
  collectUnmetCourseCodes,
  evaluateRequirementDocuments,
  extractCourseRecommendations,
} from "@/lib/requirements";
import {
  hydrateStudentPrograms,
  studentProgramEvidence,
} from "@/lib/student-program-evidence";
import type {
  AcademicEnvironment,
  RequirementNodeManualOverride,
  RequirementEvaluationContext,
  StudentCourseRecord,
} from "@/lib/types";

const MAX_RECOMMENDATIONS = 12;
type DashboardDataScope = "overview" | "progress" | "planner";

function dashboardDataScope(request: Request): DashboardDataScope {
  const requested = new URL(request.url).searchParams.get("tab");
  return requested === "progress" || requested === "planner"
    ? requested
    : "overview";
}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function publicCourse(record: typeof courseRecords.$inferSelect) {
  const { userId: _userId, ...course } = record;
  void _userId;
  return course;
}

function publicProgram(record: typeof userPrograms.$inferSelect | null) {
  if (!record) return null;
  const { userId: _userId, ...program } = record;
  void _userId;
  return program;
}

function gradePercent(grade: string | null): number | null {
  if (!grade) return null;
  const parsed = Number(grade);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function courseCodeKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function toEvaluationCourse(record: typeof courseRecords.$inferSelect): StudentCourseRecord {
  return {
    coursePid: record.coursePid,
    courseCode: record.courseCode,
    status: record.status === "transfer" ? "completed" : record.status,
    gradePercent: gradePercent(record.grade),
    credits: record.credits,
    term: record.term,
  };
}

function completedUnits(records: Array<typeof courseRecords.$inferSelect>): number | null {
  const completed = records.filter(
    (record) =>
      (record.status === "completed" || record.status === "transfer") &&
      !isNonAcademicCourseCode(record.courseCode),
  );
  const uniqueCourses = new Map<
    string,
    typeof courseRecords.$inferSelect
  >();
  for (const record of completed) {
    const key = record.coursePid || record.courseCode;
    const current = uniqueCourses.get(key);
    if (!current || (current.credits == null && record.credits != null)) {
      uniqueCourses.set(key, record);
    }
  }
  const deduplicated = [...uniqueCourses.values()];
  if (deduplicated.some((record) => record.credits == null)) return null;
  return deduplicated.reduce(
    (sum, record) =>
      sum + countedAcademicUnits(record.courseCode, record.credits),
    0,
  );
}

export async function GET(request: Request) {
  try {
    const session = await getLocalSession(request);
    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in with ROwO to continue.", 401);
    }

    const scope = dashboardDataScope(request);
    const db = getUserDb();
    const academicEnv = env as unknown as AcademicEnvironment;
    const calendarPromise = getCatalogMetadata(academicEnv);
    const overridesPromise = scope === "overview"
      ? Promise.resolve({
          overrides: [] as Array<typeof requirementNodeOverrides.$inferSelect>,
          references: [] as Array<
            typeof requirementNodeOverrideReferences.$inferSelect
          >,
        })
      : Promise.all([
          db
            .select()
            .from(requirementNodeOverrides)
            .where(eq(requirementNodeOverrides.userId, session.user.localId)),
          db
            .select({ reference: requirementNodeOverrideReferences })
            .from(requirementNodeOverrideReferences)
            .innerJoin(
              requirementNodeOverrides,
              eq(
                requirementNodeOverrideReferences.overrideId,
                requirementNodeOverrides.id,
              ),
            )
            .where(eq(requirementNodeOverrides.userId, session.user.localId)),
        ]).then(([overrides, referenceRows]) => ({
          overrides,
          references: referenceRows.map((row) => row.reference),
        }));
    const [programRows, records, overrideData, calendar] = await Promise.all([
      db
        .select()
        .from(userPrograms)
        .where(eq(userPrograms.userId, session.user.localId))
        .orderBy(desc(userPrograms.isPrimary), desc(userPrograms.updatedAt)),
      db
        .select()
        .from(courseRecords)
        .where(eq(courseRecords.userId, session.user.localId))
        .orderBy(desc(courseRecords.updatedAt)),
      overridesPromise,
      calendarPromise,
    ]);
    const overrideRows = overrideData.overrides;
    const overrideReferenceRows = overrideData.references;
    const referencesByOverride = new Map<
      string,
      typeof overrideReferenceRows
    >();
    for (const reference of overrideReferenceRows) {
      const references = referencesByOverride.get(reference.overrideId) ?? [];
      references.push(reference);
      referencesByOverride.set(reference.overrideId, references);
    }
    const selectedProgram =
      programRows.find((program) => program.isPrimary) ?? programRows[0] ?? null;
    const evaluationCourses = records.map(toEvaluationCourse);
    const activeProgramPids = programRows
      .filter((program) => program.catalogId === calendar.catalogId)
      .map((program) => program.programPid);
    const [hydratedPrograms, requirementDocuments] = await Promise.all([
      hydrateStudentPrograms(
        academicEnv,
        programRows,
        calendar.catalogId,
      ),
      scope === "overview"
        ? Promise.resolve([])
        : getProgramRequirementDocumentsByPids(
            academicEnv,
            activeProgramPids,
          ),
    ]);
    const requirementDocumentsByPid = new Map<
      string,
      typeof requirementDocuments
    >();
    for (const document of requirementDocuments) {
      const documents =
        requirementDocumentsByPid.get(document.ownerPid) ?? [];
      documents.push(document);
      requirementDocumentsByPid.set(document.ownerPid, documents);
    }
    const evaluationPrograms = studentProgramEvidence(hydratedPrograms);
    const sharedCompletedUnits = completedUnits(records);
    const programProgress = await Promise.all(
      programRows.map(async (savedProgram, index) => {
        const calendarMismatch = savedProgram.catalogId !== calendar.catalogId;
        if (calendarMismatch) {
          return {
            saved: publicProgram(savedProgram),
            catalog: null,
            calendarMismatch: true,
            requirementAnalysis: null,
            recommendations: [],
          };
        }

        const program = hydratedPrograms[index]?.catalog ?? null;
        if (scope === "overview") {
          return {
            saved: publicProgram(savedProgram),
            catalog: program,
            calendarMismatch: false,
            requirementAnalysis: null,
            recommendations: [],
          };
        }

        const documents =
          requirementDocumentsByPid.get(savedProgram.programPid) ?? [];
        const context: RequirementEvaluationContext = {
          courses: evaluationCourses,
          programs: evaluationPrograms,
          completedUnits: sharedCompletedUnits,
        };
        const versionMatches = program?.versionId === savedProgram.programVersionId;
        const currentDocuments = documents.filter(
          (document) =>
            document.catalogId === savedProgram.catalogId &&
            document.ownerPid === savedProgram.programPid &&
            document.ownerVersionId === savedProgram.programVersionId,
        );
        const overrideCandidates = overrideRows.filter(
          (override) =>
            versionMatches &&
            override.userProgramId === savedProgram.id &&
            override.catalogId === savedProgram.catalogId &&
            override.programVersionId === savedProgram.programVersionId,
        );
        const overrideDocumentIds = new Set(
          overrideCandidates.map((override) => override.documentId),
        );
        const documentSourceKeys = overrideCandidates.length === 0
          ? new Map<string, string>()
          : new Map(
              await Promise.all(
                currentDocuments
                  .filter((document) =>
                    overrideDocumentIds.has(document.documentId),
                  )
                  .map(async (document) => [
                    document.documentId,
                    await requirementDocumentSourceKey(document),
                  ] as const),
              ),
            );
        const nodeOverrides: RequirementNodeManualOverride[] = overrideCandidates
          .filter(
            (override) =>
              documentSourceKeys.get(override.documentId) ===
                override.documentSourceHash,
          )
          .map((override) => ({
            id: override.id,
            documentId: override.documentId,
            nodeKey: override.nodeKey,
            state: override.state,
            note: override.note,
            references: (referencesByOverride.get(override.id) ?? []).map(
              (reference) => ({
                id: reference.id,
                targetType: reference.targetType,
                targetPid: reference.targetPid,
                targetVersionId: reference.targetVersionId,
                targetCode: reference.targetCode,
                targetTitle: reference.targetTitle,
                credits: reference.credits,
                resolutionStatus: "resolved" as const,
              }),
            ),
            updatedAt: override.updatedAt,
          }));
        const requirementAnalysis = evaluateRequirementDocuments(
          documents,
          context,
          { nodeOverrides },
        );
        const recommendations = scope === "planner"
          ? (() => {
              const unmetCodes = new Set(
                collectUnmetCourseCodes(requirementAnalysis),
              );
              const documentStates = new Map(
                requirementAnalysis.documents.map((document) => [
                  document.documentId,
                  document.state,
                ]),
              );
              return extractCourseRecommendations(
                documents,
                context,
                requirementAnalysis,
              )
                .filter(
                  (reference) =>
                    unmetCodes.has(reference.courseCode) &&
                    documentStates.get(reference.documentId) !== "MET",
                )
                .slice(0, MAX_RECOMMENDATIONS);
            })()
          : [];

        return {
          saved: publicProgram(savedProgram),
          catalog: program,
          calendarMismatch: false,
          requirementAnalysis,
          recommendations,
        };
      }),
    );

    const recommendationMap = new Map<
      string,
      {
        courseCode: string;
        reason: string;
        isOption: boolean;
        programs: Array<{
          programId: string;
          programCode: string;
          programName: string;
          reason: string;
        }>;
      }
    >();
    for (const progress of programProgress) {
      if (!progress.saved) continue;
      for (const reference of progress.recommendations) {
        const current = recommendationMap.get(reference.courseCode) ?? {
          courseCode: reference.courseCode,
          reason: reference.reason,
          isOption: reference.isOption,
          programs: [],
        };
        if (
          !current.programs.some(
            (program) => program.programId === progress.saved?.id,
          )
        ) {
          current.programs.push({
            programId: progress.saved.id,
            programCode: progress.saved.programCode,
            programName: progress.saved.programName,
            reason: reference.reason,
          });
        }
        current.isOption = current.isOption && reference.isOption;
        recommendationMap.set(reference.courseCode, current);
      }
    }

    const rankedRecommendations = [...recommendationMap.values()]
      .sort(
        (left, right) =>
          right.programs.length - left.programs.length ||
          left.courseCode.localeCompare(right.courseCode),
      )
      .slice(0, MAX_RECOMMENDATIONS);
    const recommendationCourses = await getCoursesByCodes(
      academicEnv,
      rankedRecommendations.map((recommendation) => recommendation.courseCode),
    );
    const recommendationCoursesByCode = new Map(
      recommendationCourses.map((course) => [
        courseCodeKey(course.code),
        course,
      ]),
    );
    const recommendations = rankedRecommendations.map(
      (recommendation) => ({
        ...recommendation,
        planCount: recommendation.programs.length,
        course:
          recommendationCoursesByCode.get(
            courseCodeKey(recommendation.courseCode),
          ) ?? null,
      }),
    );

    const selectedProgress = selectedProgram
      ? programProgress.find((progress) => progress.saved?.id === selectedProgram.id) ?? null
      : null;
    const calendarMismatch = selectedProgress?.calendarMismatch === true;
    const catalogProgram = selectedProgress?.catalog ?? null;

    return Response.json(
      {
        success: true,
        dataScope: scope,
        user: {
          id: session.user.id,
          username: session.user.username,
          wechatId: session.user.wechatId,
          role: session.user.role,
        },
        program: {
          selected: publicProgram(selectedProgram),
          catalog: catalogProgram,
          calendarMismatch,
        },
        programs:
          scope === "planner"
            ? []
            : programProgress.map(
                ({ recommendations: _recommendations, ...progress }) => {
                  void _recommendations;
                  return {
                    ...progress,
                    requirementAnalysis:
                      scope === "progress"
                        ? progress.requirementAnalysis
                        : null,
                  };
                },
              ),
        courseRecords:
          scope === "progress" ? [] : records.map(publicCourse),
        calendar,
        recommendedUnmetCourseReferences:
          scope === "planner" ? recommendations : [],
        progress: {
          completedUnits: completedUnits(records),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AcademicDataError) {
      return errorResponse(
        "ACADEMIC_CATALOG_UNAVAILABLE",
        "The academic calendar is temporarily unavailable.",
        503,
      );
    }
    return errorResponse("INTERNAL_ERROR", "Unable to load the dashboard.", 500);
  }
}
