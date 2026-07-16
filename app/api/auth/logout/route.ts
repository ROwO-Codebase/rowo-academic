import {
  clearSessionCookieHeader,
  deleteLocalSession,
  isSameOriginMutation,
  safeReturnPath,
} from "@/lib/auth";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return Response.json(
      { success: false, error: "Cross-origin logout blocked." },
      { status: 403, headers: { "cache-control": "no-store, private" } },
    );
  }

  const returnTo = safeReturnPath(
    new URL(request.url).searchParams.get("returnTo"),
  );

  try {
    await deleteLocalSession(request);
  } catch {
    return Response.json(
      {
        success: false,
        error: "The server session could not be revoked. Please try again.",
        redirectTo: returnTo,
      },
      {
        status: 503,
        headers: {
          "cache-control": "no-store, private",
        },
      },
    );
  }

  return Response.json(
    { success: true, redirectTo: returnTo },
    {
      headers: {
        "cache-control": "no-store, private",
        "set-cookie": clearSessionCookieHeader(request),
      },
    },
  );
}
