import { RunView } from "@repo/admin/sprints/run-view";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export default async function SprintRunRoute({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <AdminFeatureShell>
      <RunView key={runId} runId={runId} />
    </AdminFeatureShell>
  );
}
