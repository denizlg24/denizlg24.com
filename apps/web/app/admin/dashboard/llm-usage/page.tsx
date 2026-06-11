import { Brain } from "lucide-react";
import { forbidden } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import { LlmUsageDashboard } from "./_components/llm-usage-dashboard";

export default async function Page() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Brain className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Token Usage</span>
      </div>
      <LlmUsageDashboard />
    </div>
  );
}
