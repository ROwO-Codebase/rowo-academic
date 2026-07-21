import { and, eq, isNull } from "drizzle-orm";
import { getUserDb } from "@/db";
import { shareLinks } from "@/db/schema";
import { getLocalSession, isSameOriginMutation } from "@/lib/auth";

const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RouteContext = { params: Promise<{ id: string }> | { id: string } };

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "private, no-store" } },
  );
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
    const { id } = await context.params;
    if (!SHARE_ID.test(id)) {
      return errorResponse("INVALID_LINK", "The share link id is invalid.", 400);
    }
    const revokedAt = Date.now();
    const revoked = await getUserDb()
      .update(shareLinks)
      .set({ revokedAt })
      .where(
        and(
          eq(shareLinks.id, id),
          eq(shareLinks.userId, session.user.localId),
          isNull(shareLinks.revokedAt),
        ),
      )
      .returning({ id: shareLinks.id });
    if (revoked.length === 0) {
      return errorResponse("LINK_NOT_FOUND", "Active share link not found.", 404);
    }
    return Response.json(
      { success: true, revoked: { id, revokedAt } },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return errorResponse("INTERNAL_ERROR", "Unable to revoke the share link.", 500);
  }
}

