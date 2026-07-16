import { env } from "cloudflare:workers";
import {
  AcademicDataError,
  getCatalogMetadata,
  getCourseByPid,
  getCourseRequirementDocuments,
} from "@/lib/academic";
import { summarizePublicRequirement } from "@/lib/public-academic";
import type { AcademicEnvironment } from "@/lib/types";

type RouteContext = { params: Promise<{ pid: string }> | { pid: string } };

class InputError extends Error {}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function routePid(context: RouteContext): Promise<string> {
  const { pid } = await context.params;
  const normalized = pid.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new InputError("The course identifier is invalid.");
  }
  return normalized;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const pid = await routePid(context);
    const academicEnv = env as unknown as AcademicEnvironment;
    const [course, requirements, catalog] = await Promise.all([
      getCourseByPid(academicEnv, pid),
      getCourseRequirementDocuments(academicEnv, pid),
      getCatalogMetadata(academicEnv),
    ]);
    if (!course) {
      return errorResponse("COURSE_NOT_FOUND", "Course not found.", 404);
    }
    const { notesHtml: _notesHtml, ...publicCourse } = course;
    void _notesHtml;

    return Response.json(
      {
        success: true,
        catalog,
        course: publicCourse,
        requirements: requirements.map(summarizePublicRequirement),
      },
      { headers: { "cache-control": "public, max-age=300, s-maxage=900" } },
    );
  } catch (error) {
    if (error instanceof InputError) {
      return errorResponse("INVALID_COURSE", error.message, 400);
    }
    if (error instanceof AcademicDataError) {
      return errorResponse(
        "ACADEMIC_CATALOG_UNAVAILABLE",
        "The academic calendar is temporarily unavailable.",
        503,
      );
    }
    return errorResponse("INTERNAL_ERROR", "Unable to load the course.", 500);
  }
}
