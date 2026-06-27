"use client";

import {
  LlmUsagePage,
  LlmUsageSkeleton,
} from "@repo/admin/llm-usage/llm-usage-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function LlmUsageRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <LlmUsageSkeleton /> : <LlmUsagePage />}
    </AdminProvider>
  );
}
