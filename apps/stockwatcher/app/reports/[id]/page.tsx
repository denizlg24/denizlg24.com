import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DeckViewer } from "@/components/reports/deck-view";
import { PreviewToolbar } from "@/components/reports/preview-toolbar";
import { ReportView } from "@/components/reports/report-view";
import { appOrigin, currentUser } from "@/lib/auth";
import { readWorkspace } from "@/lib/db";
import { links } from "@/lib/reports/service";
import { getReport } from "@/lib/reports/store";

export const metadata: Metadata = {
  title: "Report preview · Stockwatcher",
  robots: { index: false, follow: false },
};

export default async function ReportPreview({
  params,
}: PageProps<"/reports/[id]">) {
  const user = await currentUser();
  if (!user) redirect("/");
  const found = await getReport(user.id, (await params).id);
  if (!found) notFound();
  const { data } = await readWorkspace(user.id);
  const head = await headers();
  const host = head.get("host") ?? "localhost";
  const protocol = head.get("x-forwarded-proto") ?? "http";
  const { shareUrl } = links(
    found,
    appOrigin(new Request(`${protocol}://${host}`)),
  );
  const toolbar = (
    <PreviewToolbar
      id={found.id}
      kind={found.kind}
      shareUrl={shareUrl}
      theme={data.settings.theme}
    />
  );
  if (found.kind === "deck")
    return (
      <main className="deck-page">
        <DeckViewer deck={found.doc} toolbar={toolbar} />
      </main>
    );
  return (
    <main className="doc-page">
      {toolbar}
      <ReportView doc={found.doc} label="Preview" />
    </main>
  );
}
