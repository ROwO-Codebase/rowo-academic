import type { Metadata } from "next";
import { AcademicDashboard } from "./AcademicDashboard";

export const metadata: Metadata = {
  title: "My academic plan",
  description:
    "Track program requirements and plan future Waterloo courses with ROwO Academic.",
};

export const dynamic = "force-dynamic";

export default function AcademicAppPage() {
  return <AcademicDashboard />;
}
