import type { Metadata } from "next";
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

export default async function AcademicAppPage({ searchParams }: AcademicAppPageProps) {
  const params = (await searchParams) ?? {};
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
    />
  );
}
