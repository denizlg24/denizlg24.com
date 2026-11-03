import { SprintPage } from "@repo/admin/sprints/sprint-page";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default async function SprintRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <SprintPage key={id} sprintId={id} />
    </AdminFeatureShell>
  );
}
