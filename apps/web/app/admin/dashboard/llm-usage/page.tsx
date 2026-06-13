import { Brain } from "lucide-react";
import { forbidden } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import { AdminPageHeader } from "../_components/admin-page-header";
import { LlmUsageDashboard } from "./_components/llm-usage-dashboard";

export default async function Page() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  return (
    <div className="flex flex-col gap-2 pb-8">
      <AdminPageHeader
        icon={<Brain className="size-4 text-muted-foreground" />}
        title="Token Usage"
      />
      <LlmUsageDashboard />
    </div>
  );
}
