import { DeckPage } from "@repo/admin/study/deck-page";
import { AdminFeatureShell } from "../../../../_components/admin-feature-shell";

export default async function DeckRoute({
  params,
}: {
  params: Promise<{ id: string; deckId: string }>;
}) {
  const { id, deckId } = await params;
  return (
    <AdminFeatureShell>
      <DeckPage key={deckId} notebookId={id} deckId={deckId} />
    </AdminFeatureShell>
  );
}
