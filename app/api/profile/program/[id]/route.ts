import { and, desc, eq, ne } from "drizzle-orm";
import { getUserDb } from "@/db";
import { userPrograms } from "@/db/schema";
import { getLocalSession, isSameOriginMutation } from "@/lib/auth";

const PROGRAM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

class InputError extends Error {}

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function routeId(context: RouteContext): Promise<string> {
  const { id } = await context.params;
  if (!PROGRAM_ID.test(id)) throw new InputError("The tracked plan id is invalid.");
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
    const db = getUserDb();
    const [existing] = await db
      .select()
      .from(userPrograms)
      .where(
        and(
          eq(userPrograms.id, id),
          eq(userPrograms.userId, session.user.localId),
        ),
      )
      .limit(1);
    if (!existing) {
      return errorResponse("PROGRAM_NOT_FOUND", "Tracked plan not found.", 404);
    }

    const [nextPrimary] = existing.isPrimary
      ? await db
          .select()
          .from(userPrograms)
          .where(
            and(
              eq(userPrograms.userId, session.user.localId),
              ne(userPrograms.id, existing.id),
            ),
          )
          .orderBy(desc(userPrograms.updatedAt))
          .limit(1)
      : [];
    const deleteProgram = db
      .delete(userPrograms)
      .where(
        and(
          eq(userPrograms.id, existing.id),
          eq(userPrograms.userId, session.user.localId),
        ),
      );
    if (nextPrimary) {
      await db.batch([
        deleteProgram,
        db
          .update(userPrograms)
          .set({ isPrimary: true, updatedAt: Date.now() })
          .where(
            and(
              eq(userPrograms.id, nextPrimary.id),
              eq(userPrograms.userId, session.user.localId),
            ),
          ),
      ]);
    } else {
      await deleteProgram;
    }

    return Response.json(
      { success: true, deleted: { id: existing.id } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InputError) {
      return errorResponse("INVALID_PROGRAM", error.message, 400);
    }
    return errorResponse("INTERNAL_ERROR", "Unable to remove the tracked plan.", 500);
  }
}
