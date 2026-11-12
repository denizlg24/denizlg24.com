import { ReviewPage } from "@repo/admin/study/review-page";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export default async function ReviewRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ deck?: string }>;
}) {
  const [{ id }, { deck }] = await Promise.all([params, searchParams]);
  return (
    <AdminFeatureShell>
      <ReviewPage key={`${id}:${deck ?? ""}`} notebookId={id} deckId={deck} />
    </AdminFeatureShell>
  );
}
