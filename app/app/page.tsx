import type { Metadata } from "next";
import { headers } from "next/headers";
import { GET as getDashboardResponse } from "../api/dashboard/route";
import { AcademicDashboard } from "./AcademicDashboard";

export const metadata: Metadata = {
  title: "Academic plans and courses",
  description:
    "Browse Waterloo plan and course information as a guest, or sign in to track and save your academic plan.",
};

export const dynamic = "force-dynamic";

type AcademicAppPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function dashboardRequestUrl(requestHeaders: Headers): string {
  const forwardedHost = requestHeaders
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost ?? requestHeaders.get("host");
  const validHost = Boolean(
    host &&
      (/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) ||
        /^\[::1\](?::\d{1,5})?$/.test(host)),
  );
  const safeHost =
    validHost && host ? host : "academic.rowo.link";
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(
    safeHost,
  );
  const protocol =
    localHost && forwardedProtocol !== "https" ? "http" : "https";
  return `${protocol}://${safeHost}/api/dashboard?tab=overview`;
}

async function loadInitialDashboard(): Promise<{
  status: "ready" | "guest" | "error";
  payload: unknown;
  error: string;
}> {
  try {
    const requestHeaders = new Headers(await headers());
    const response = await getDashboardResponse(
      new Request(dashboardRequestUrl(requestHeaders), {
        headers: requestHeaders,
      }),
    );
    if (response.ok) {
      return {
        status: "ready",
        payload: await response.json(),
        error: "",
      };
    }
    if (response.status === 401) {
      return { status: "guest", payload: null, error: "" };
    }
    return {
      status: "error",
      payload: null,
      error: "Your plan could not be loaded.",
    };
  } catch {
    return {
      status: "error",
      payload: null,
      error: "Your plan could not be loaded.",
    };
  }
}

export default async function AcademicAppPage({ searchParams }: AcademicAppPageProps) {
  const [params, initialDashboard] = await Promise.all([
    searchParams ??
      Promise.resolve<Record<string, string | string[] | undefined>>({}),
    loadInitialDashboard(),
  ]);
  const requestedTab = firstParam(params.tab);
  const initialBrowserTab =
    requestedTab === "courses" || requestedTab === "plans"
      ? requestedTab
      : null;
  return (
    <AcademicDashboard
      initialBrowserTab={initialBrowserTab}
      initialQuery={firstParam(params.q)}
      initialCoursePid={firstParam(params.course)}
      initialProgramPid={firstParam(params.plan)}
      initialDashboardPayload={initialDashboard.payload}
      initialLoadState={initialDashboard.status}
      initialLoadError={initialDashboard.error}
    />
  );
}
