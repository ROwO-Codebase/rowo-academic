import type { Metadata } from "next";
import { SharedPlanView } from "./SharedPlanView";

export const metadata: Metadata = {
  title: "Shared academic plan",
  description: "A read-only academic plan shared through ROwO Academic.",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export const dynamic = "force-dynamic";

type SharedPlanPageProps = {
  params: Promise<{ token: string }> | { token: string };
};

export default async function SharedPlanPage({ params }: SharedPlanPageProps) {
  const { token } = await params;
  return <SharedPlanView token={token} />;
}
