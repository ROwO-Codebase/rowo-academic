import type { Metadata } from "next";
import { AcademicDashboard } from "./AcademicDashboard";

export const metadata: Metadata = {
  title: "Academic plans and courses",
  description:
    "Browse Waterloo plan and course information as a guest, or sign in to track and save your academic plan.",
};

export const dynamic = "force-dynamic";

export default function AcademicAppPage() {
  return <AcademicDashboard />;
}
