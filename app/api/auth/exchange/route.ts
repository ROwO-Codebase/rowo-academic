import {
  clearSsoStateCookieHeader,
  createLocalSession,
  deleteLocalSession,
  hasValidSsoState,
  isSameOriginMutation,
  RowoAuthError,
  safeReturnPath,
  sessionCookieHeader,
  validateRowoToken,
} from "@/lib/auth";

const MAX_EXCHANGE_BODY_BYTES = 12_000;

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return jsonError(request, "Cross-origin sign-in exchange blocked.", 403);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return jsonError(request, "A JSON request body is required.", 415);
  }

  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && !/^\d+$/.test(lengthHeader)) {
    return jsonError(request, "The sign-in request has an invalid length.", 400);
  }
  if (lengthHeader && Number(lengthHeader) > MAX_EXCHANGE_BODY_BYTES) {
    return jsonError(request, "The sign-in request is too large.", 413);
  }

  let rawBody: string;
  try {
    rawBody = await readUtf8BodyWithLimit(request, MAX_EXCHANGE_BODY_BYTES);
  } catch (error) {
    return error instanceof BodyTooLargeError
      ? jsonError(request, "The sign-in request is too large.", 413)
      : jsonError(request, "The sign-in request could not be read.", 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonError(request, "The sign-in request is not valid JSON.", 400);
  }

  if (!isRecord(payload) || typeof payload.token !== "string") {
    return jsonError(request, "A ROwO sign-in token is required.", 400);
  }
  if (!hasValidSsoState(request, payload.state)) {
    return jsonError(
      request,
      "This ROwO sign-in request is missing or expired.",
      403,
      true,
    );
  }

  let upstreamToken = payload.token;
  const returnTo = safeReturnPath(
    typeof payload.returnTo === "string" ? payload.returnTo : null,
  );
  delete payload.token;

  try {
    const profile = await validateRowoToken(upstreamToken);
    upstreamToken = "";
    await deleteLocalSession(request);
    const { token, session } = await createLocalSession(profile);

    const headers = new Headers({
      "cache-control": "no-store, private",
      "referrer-policy": "no-referrer",
    });
    headers.append(
      "set-cookie",
      sessionCookieHeader(request, token, session.expiresAt),
    );
    headers.append("set-cookie", clearSsoStateCookieHeader(request));

    return Response.json(
      {
        success: true,
        redirectTo: returnTo,
        user: session.user,
      },
      {
        headers,
      },
    );
  } catch (error) {
    upstreamToken = "";
    if (error instanceof RowoAuthError) {
      return jsonError(request, error.message, error.status, true);
    }
    return jsonError(
      request,
      "The local Academic session could not be created.",
      500,
      true,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function jsonError(
  request: Request,
  error: string,
  status: number,
  clearState = false,
): Response {
  const headers = new Headers({
    "cache-control": "no-store, private",
    "referrer-policy": "no-referrer",
  });
  if (clearState) {
    headers.append("set-cookie", clearSsoStateCookieHeader(request));
  }

  return Response.json(
    { success: false, error },
    {
      status,
      headers,
    },
  );
}

class BodyTooLargeError extends Error {}

async function readUtf8BodyWithLimit(
  request: Request,
  limit: number,
): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let received = 0;
  let result = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}
