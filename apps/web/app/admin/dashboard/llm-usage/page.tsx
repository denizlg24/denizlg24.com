import { LlmUsagePage } from "@repo/admin/llm-usage/llm-usage-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function Page() {
  return (
    <AdminFeatureShell>
      <LlmUsagePage />
    </AdminFeatureShell>
  );
}
