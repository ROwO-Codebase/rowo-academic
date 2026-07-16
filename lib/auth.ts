import { env } from "cloudflare:workers";
import { and, eq, lte } from "drizzle-orm";
import { getUserDb } from "@/db";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE_NAME = "__Host-rowo-academic-session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SSO_STATE_COOKIE_NAME = "__Host-rowo-academic-sso-state";

const LOCAL_SESSION_COOKIE_NAME = "rowo-academic-session";
const LOCAL_SSO_STATE_COOKIE_NAME = "rowo-academic-sso-state";
const DEFAULT_ROWO_API_ORIGIN = "https://api.rowo.link";
const DEFAULT_ROWO_WEB_ORIGIN = "https://rowo.link";
const PRODUCTION_APP_ORIGIN = "https://academic.rowo.link";
const MAX_RETURN_PATH_LENGTH = 2_048;
const MAX_UPSTREAM_TOKEN_LENGTH = 8_192;
const SSO_STATE_TTL_MS = 10 * 60 * 1000;

const RESERVED_RETURN_PATHS = new Set([
  "/auth/login",
  "/auth/sso-callback",
  "/api/auth/exchange",
  "/api/auth/logout",
]);

type AuthRuntimeBindings = {
  ROWO_AUTH?: Fetcher;
  ROWO_API_ORIGIN?: string;
  ROWO_WEB_ORIGIN?: string;
};

type AuthOriginBinding = "ROWO_API_ORIGIN" | "ROWO_WEB_ORIGIN";

type CookieKind = "session" | "sso-state";

export type RowoRole = "user" | "moderator" | "admin" | "super_admin";

export type RowoProfile = {
  id: string;
  username: string;
  wechatId: string | null;
  role: RowoRole;
};

export type LocalUser = RowoProfile & {
  /** App-local primary key. */
  localId: string;
};

export type LocalSession = {
  user: LocalUser;
  expiresAt: number;
};

export class RowoAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RowoAuthError";
    this.status = status;
  }
}

/**
 * Accept only a same-origin relative destination. Auth endpoints are excluded
 * to prevent callback and logout loops.
 */
export function safeReturnPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (
    !value ||
    value.length > MAX_RETURN_PATH_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\r\n]/.test(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, PRODUCTION_APP_ORIGIN);
    if (
      parsed.origin !== PRODUCTION_APP_ORIGIN ||
      RESERVED_RETURN_PATHS.has(parsed.pathname)
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

/** Require browser mutations to originate from the exact application origin. */
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** Build a login-CSRF-bound, allowlist-gated ROwO first-party SSO hand-off. */
export function createRowoSsoLogin(
  request: Request,
  returnTo: string,
): { url: URL; stateCookie: string } {
  const requestUrl = new URL(request.url);
  const callbackOrigin =
    requestUrl.protocol === "https:" ||
    (requestUrl.protocol === "http:" &&
      isLocalDevelopmentHost(requestUrl.hostname))
      ? requestUrl.origin
      : PRODUCTION_APP_ORIGIN;
  const callback = new URL("/auth/sso-callback", callbackOrigin);
  const state = randomSecret();
  callback.searchParams.set("returnTo", safeReturnPath(returnTo));
  callback.searchParams.set("state", state);

  const sso = new URL("/sso", runtimeOrigin("ROWO_WEB_ORIGIN"));
  sso.searchParams.set("next", callback.toString());
  const stateExpiresAt = Date.now() + SSO_STATE_TTL_MS;
  return {
    url: sso,
    stateCookie: cookieHeader(request, "sso-state", state, stateExpiresAt),
  };
}

export function hasValidSsoState(request: Request, state: unknown): boolean {
  if (typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
    return false;
  }
  const cookieState = readCookie(
    request,
    cookiePolicy(request, "sso-state").name,
  );
  return Boolean(cookieState && constantTimeEqual(cookieState, state));
}

/** Validate a transient ROwO session JWT without parsing or persisting it. */
export async function validateRowoToken(token: string): Promise<RowoProfile> {
  const normalizedToken = token.trim();
  if (
    normalizedToken.length < 20 ||
    normalizedToken.length > MAX_UPSTREAM_TOKEN_LENGTH ||
    /\s/.test(normalizedToken)
  ) {
    throw new RowoAuthError("The ROwO sign-in token is invalid.", 401);
  }

  let response: Response;
  try {
    const meUrl = new URL("/api/user/me", runtimeOrigin("ROWO_API_ORIGIN"));
    const request = new Request(meUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${normalizedToken}`,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    const rowoAuth = (env as unknown as AuthRuntimeBindings).ROWO_AUTH;
    response = rowoAuth
      ? await rowoAuth.fetch(request)
      : await fetch(request);
  } catch (error) {
    console.error(
      "ROwO verification request failed",
      error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error",
    );
    throw new RowoAuthError(
      "ROwO could not be reached to verify this sign-in.",
      502,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new RowoAuthError(
      "ROwO returned an unexpected redirect while verifying this sign-in.",
      502,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new RowoAuthError("The ROwO sign-in token is invalid or expired.", 401);
  }
  if (!response.ok) {
    throw new RowoAuthError(
      "ROwO could not verify this sign-in right now.",
      502,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RowoAuthError("ROwO returned an invalid profile response.", 502);
  }

  const profile = parseRowoProfile(body);
  if (!profile) {
    throw new RowoAuthError("ROwO returned an invalid profile response.", 502);
  }
  return profile;
}

/** Upsert the local user and issue a random, fixed-expiry app session. */
export async function createLocalSession(
  profile: RowoProfile,
): Promise<{ token: string; session: LocalSession }> {
  const db = getUserDb();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const localUserId = crypto.randomUUID();

  const [localUser] = await db
    .insert(users)
    .values({
      id: localUserId,
      rowoUserId: profile.id,
      username: profile.username,
      wechatId: profile.wechatId,
      role: profile.role,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.rowoUserId,
      set: {
        username: profile.username,
        wechatId: profile.wechatId,
        role: profile.role,
        updatedAt: now,
      },
    })
    .returning({ id: users.id });

  if (!localUser) {
    throw new Error("Failed to create the local ROwO user.");
  }

  const token = randomSecret();
  const tokenHash = await hashSessionToken(token);

  await db.delete(sessions).where(lte(sessions.expiresAt, now));
  await db.insert(sessions).values({
    tokenHash,
    userId: localUser.id,
    createdAt: now,
    expiresAt,
  });

  return {
    token,
    session: {
      user: {
        localId: localUser.id,
        id: profile.id,
        username: profile.username,
        wechatId: profile.wechatId,
        role: profile.role,
      },
      expiresAt,
    },
  };
}

export async function getLocalSession(
  request: Request,
): Promise<LocalSession | null> {
  const token = readSessionToken(request);
  if (!token) return null;

  const tokenHash = await hashSessionToken(token);
  const db = getUserDb();
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      localId: users.id,
      rowoUserId: users.rowoUserId,
      username: users.username,
      wechatId: users.wechatId,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), eq(users.id, sessions.userId)))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }

  return {
    user: {
      localId: row.localId,
      id: row.rowoUserId,
      username: row.username,
      wechatId: row.wechatId,
      role: row.role,
    },
    expiresAt: row.expiresAt,
  };
}

export async function deleteLocalSession(request: Request): Promise<void> {
  const token = readSessionToken(request);
  if (!token) return;

  const tokenHash = await hashSessionToken(token);
  await getUserDb().delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export function sessionCookieHeader(
  request: Request,
  token: string,
  expiresAt: number,
): string {
  return cookieHeader(request, "session", token, expiresAt);
}

export function clearSessionCookieHeader(request: Request): string {
  return clearCookieHeader(request, "session");
}

export function clearSsoStateCookieHeader(request: Request): string {
  return clearCookieHeader(request, "sso-state");
}

function clearCookieHeader(request: Request, kind: CookieKind): string {
  const { name, secure } = cookiePolicy(request, kind);
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    ...(secure ? ["Secure"] : []),
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ");
}

function parseRowoProfile(body: unknown): RowoProfile | null {
  if (!isRecord(body) || body.success !== true || !isRecord(body.user)) {
    return null;
  }

  const { user } = body;
  if (
    typeof user.id !== "string" ||
    user.id.length === 0 ||
    user.id.length > 256 ||
    typeof user.username !== "string" ||
    user.username.length === 0 ||
    user.username.length > 256
  ) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    wechatId:
      typeof user.wechat_id === "string" && user.wechat_id.length <= 256
        ? user.wechat_id
        : null,
    role: isRowoRole(user.role) ? user.role : "user",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRowoRole(value: unknown): value is RowoRole {
  return (
    value === "user" ||
    value === "moderator" ||
    value === "admin" ||
    value === "super_admin"
  );
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function readSessionToken(request: Request): string | null {
  const value = readCookie(request, cookiePolicy(request, "session").name);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function readCookie(request: Request, expectedName: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== expectedName) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function cookieHeader(
  request: Request,
  kind: CookieKind,
  value: string,
  expiresAt: number,
): string {
  const { name, secure } = cookiePolicy(request, kind);
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1_000));
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    ...(secure ? ["Secure"] : []),
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join("; ");
}

function cookiePolicy(
  request: Request,
  kind: CookieKind,
): { name: string; secure: boolean } {
  const requestUrl = new URL(request.url);
  const isHttpLocalhost =
    requestUrl.protocol === "http:" &&
    isLocalDevelopmentHost(requestUrl.hostname);

  if (kind === "session") {
    return {
      name: isHttpLocalhost ? LOCAL_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME,
      secure: !isHttpLocalhost,
    };
  }
  return {
    name: isHttpLocalhost
      ? LOCAL_SSO_STATE_COOKIE_NAME
      : SSO_STATE_COOKIE_NAME,
    secure: !isHttpLocalhost,
  };
}

function runtimeOrigin(
  key: AuthOriginBinding,
): string {
  const bindings = env as unknown as AuthRuntimeBindings;
  const fallback =
    key === "ROWO_API_ORIGIN"
      ? DEFAULT_ROWO_API_ORIGIN
      : DEFAULT_ROWO_WEB_ORIGIN;
  const configured = bindings[key];
  if (!configured) return fallback;

  try {
    const parsed = new URL(configured);
    const isSecure = parsed.protocol === "https:";
    const isLocalHttp =
      parsed.protocol === "http:" && isLocalDevelopmentHost(parsed.hostname);
    return isSecure || isLocalHttp ? parsed.origin : fallback;
  } catch {
    return fallback;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
