import { eq } from "drizzle-orm";
import { getUserDb } from "@/db";
import { shareLinks, users } from "@/db/schema";
import {
  ShareInputError,
  hashShareToken,
  isShareToken,
  parseStoredShareSnapshot,
} from "@/lib/share-links";

type RouteContext = { params: Promise<{ token: string }> | { token: string } };

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "no-store, max-age=0" } },
  );
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params;
    if (!isShareToken(token)) {
      return errorResponse("LINK_NOT_FOUND", "This share link does not exist.", 404);
    }
    const [row] = await getUserDb()
      .select({ link: shareLinks, ownerName: users.username })
      .from(shareLinks)
      .innerJoin(users, eq(shareLinks.userId, users.id))
      .where(eq(shareLinks.tokenHash, await hashShareToken(token)))
      .limit(1);
    if (!row) {
      return errorResponse("LINK_NOT_FOUND", "This share link does not exist.", 404);
    }
    if (row.link.revokedAt !== null) {
      return errorResponse(
        "LINK_REVOKED",
        "The owner has stopped sharing this link.",
        410,
      );
    }
    if (row.link.expiresAt !== null && row.link.expiresAt <= Date.now()) {
      return errorResponse("LINK_EXPIRED", "This share link has expired.", 410);
    }
    const snapshot = parseStoredShareSnapshot(
      row.link.payload,
      row.link.kind,
      row.link.includeGrades,
      row.ownerName,
      row.link.createdAt,
      row.link.expiresAt,
    );
    return Response.json(
      { success: true, snapshot },
      {
        headers: {
          "cache-control": "no-store, max-age=0",
          "x-robots-tag": "noindex, nofollow, noarchive",
        },
      },
    );
  } catch (error) {
    if (error instanceof ShareInputError) {
      return errorResponse("INVALID_SHARE", "This shared plan is unavailable.", 500);
    }
    return errorResponse("INTERNAL_ERROR", "Unable to load this shared plan.", 500);
  }
}
