import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";

export const metadata: Metadata = { title: "Voice" };

export default async function VoiceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getAdminSession())) forbidden();
  return children;
}
