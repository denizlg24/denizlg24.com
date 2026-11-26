import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DeckViewer } from "@/components/reports/deck-view";
import { sharedDoc, sharedMetadata } from "@/lib/reports/public";
import { sharePath } from "@/lib/reports/types";

export async function generateMetadata({
  params,
}: PageProps<"/d/[token]">): Promise<Metadata> {
  return sharedMetadata(await sharedDoc((await params).token));
}

export default async function SharedDeck({ params }: PageProps<"/d/[token]">) {
  const { token } = await params;
  const found = await sharedDoc(token);
  if (!found) notFound();
  if (found.kind === "report") redirect(sharePath("report", token));
  return (
    <main className="deck-page">
      <DeckViewer deck={found.doc} />
    </main>
  );
}
