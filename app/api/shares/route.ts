import { and, count, desc, eq, gt, isNull, or } from "drizzle-orm";
import { getUserDb } from "@/db";
import { SHARE_LINK_KINDS, shareLinks, type ShareLinkKind } from "@/db/schema";
import { getLocalSession, isSameOriginMutation } from "@/lib/auth";
import { JsonBodyError, readBoundedJsonObject } from "@/lib/http";
import {
  ShareInputError,
  createShareToken,
  hashShareToken,
  parseShareCreateInput,
} from "@/lib/share-links";

const MAX_BODY_BYTES = 270_000;
const MAX_ACTIVE_LINKS = 25;

function errorResponse(code: string, message: string, status: number) {
  return Response.json(
    { success: false, error: { code, message } },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

function requestedKind(request: Request): ShareLinkKind | null {
  const value = new URL(request.url).searchParams.get("kind");
  return value && SHARE_LINK_KINDS.includes(value as ShareLinkKind)
    ? value as ShareLinkKind
    : null;
}

function publicLink(
  link: typeof shareLinks.$inferSelect,
  now: number,
) {
  return {
    id: link.id,
    kind: link.kind,
    includeGrades: link.includeGrades,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    active:
      link.revokedAt === null &&
      (link.expiresAt === null || link.expiresAt > now),
  };
}

export async function GET(request: Request) {
  try {
    const session = await getLocalSession(request);
    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in with ROwO to continue.", 401);
    }
    const kind = requestedKind(request);
    const condition = kind
      ? and(
          eq(shareLinks.userId, session.user.localId),
          eq(shareLinks.kind, kind),
        )
      : eq(shareLinks.userId, session.user.localId);
    const rows = await getUserDb()
      .select()
      .from(shareLinks)
      .where(condition)
      .orderBy(desc(shareLinks.createdAt))
      .limit(50);
    const now = Date.now();
    return Response.json(
      { success: true, links: rows.map((link) => publicLink(link, now)) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return errorResponse("INTERNAL_ERROR", "Unable to load your share links.", 500);
  }
}

export async function POST(request: Request) {
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
    const now = Date.now();
    const input = parseShareCreateInput(
      await readBoundedJsonObject(request, MAX_BODY_BYTES),
      now,
    );
    const db = getUserDb();
    const [activeLinks] = await db
      .select({ count: count() })
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.userId, session.user.localId),
          isNull(shareLinks.revokedAt),
          or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now)),
        ),
      );
    if ((activeLinks?.count ?? 0) >= MAX_ACTIVE_LINKS) {
      return errorResponse(
        "TOO_MANY_LINKS",
        `Invalidate an existing link before creating more than ${MAX_ACTIVE_LINKS}.`,
        409,
      );
    }
    const token = createShareToken();
    const id = crypto.randomUUID();
    await db.insert(shareLinks).values({
      id,
      userId: session.user.localId,
      tokenHash: await hashShareToken(token),
      kind: input.kind,
      includeGrades: input.includeGrades,
      payload: input.serializedSnapshot,
      createdAt: now,
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
    const url = new URL(`/share/${token}`, request.url).toString();
    return Response.json(
      {
        success: true,
        link: {
          id,
          url,
          kind: input.kind,
          includeGrades: input.includeGrades,
          createdAt: now,
          expiresAt: input.expiresAt,
          revokedAt: null,
          active: true,
        },
      },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof JsonBodyError || error instanceof ShareInputError) {
      return errorResponse("INVALID_INPUT", error.message, 400);
    }
    return errorResponse("INTERNAL_ERROR", "Unable to create the share link.", 500);
  }
}
