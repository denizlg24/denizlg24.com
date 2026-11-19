import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReportView } from "@/components/reports/report-view";
import { sharedDoc, sharedMetadata } from "@/lib/reports/public";
import { sharePath } from "@/lib/reports/types";

export async function generateMetadata({
  params,
}: PageProps<"/r/[token]">): Promise<Metadata> {
  return sharedMetadata(await sharedDoc((await params).token));
}

export default async function SharedReport({
  params,
}: PageProps<"/r/[token]">) {
  const { token } = await params;
  const found = await sharedDoc(token);
  if (!found) notFound();
  if (found.kind === "deck") redirect(sharePath("deck", token));
  return (
    <main className="doc-page">
      <ReportView doc={found.doc} />
    </main>
  );
}
