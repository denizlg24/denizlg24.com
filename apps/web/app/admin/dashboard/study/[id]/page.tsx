import { NotebookPage } from "@repo/admin/study/notebook-page";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export default async function NotebookRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return (
    <AdminFeatureShell>
      <NotebookPage key={id} notebookId={id} tab={tab} />
    </AdminFeatureShell>
  );
}
