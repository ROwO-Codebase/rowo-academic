import { createRowoSsoLogin, safeReturnPath } from "@/lib/auth";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnPath(
    requestUrl.searchParams.get("returnTo") ??
      requestUrl.searchParams.get("return_to"),
  );
  const login = createRowoSsoLogin(request, returnTo);

  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      location: login.url.toString(),
      "referrer-policy": "no-referrer",
      "set-cookie": login.stateCookie,
    },
  });
}
