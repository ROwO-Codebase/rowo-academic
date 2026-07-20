import { and, eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import { requirementNodeOverrides } from "@/db/schema";
import { getLocalSession, isSameOriginMutation } from "@/lib/auth";

const OVERRIDE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

class InputError extends Error {}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

async function routeId(context: RouteContext): Promise<string> {
  const { id } = await context.params;
  if (!OVERRIDE_ID.test(id)) {
    throw new InputError("The requirement override id is invalid.");
  }
  return id;
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!isSameOriginMutation(request)) {
      return errorResponse(
        "ORIGIN_MISMATCH",
        "This change must originate from ROwO Academic.",
        403,
      );
    }
    const session = await getLocalSession(request);
    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in with ROwO to continue.", 401);
    }

    const id = await routeId(context);
    const deleted = await getUserDb()
      .delete(requirementNodeOverrides)
      .where(
        and(
          eq(requirementNodeOverrides.id, id),
          eq(requirementNodeOverrides.userId, session.user.localId),
        ),
      )
      .returning({ id: requirementNodeOverrides.id });
    if (deleted.length === 0) {
      return errorResponse(
        "REQUIREMENT_OVERRIDE_NOT_FOUND",
        "Requirement override not found.",
        404,
      );
    }

    return Response.json(
      { success: true, deleted: { id } },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof InputError) {
      return errorResponse("INVALID_OVERRIDE", error.message, 400);
    }
    return errorResponse(
      "INTERNAL_ERROR",
      "Unable to revert the requirement override.",
      500,
    );
  }
}
