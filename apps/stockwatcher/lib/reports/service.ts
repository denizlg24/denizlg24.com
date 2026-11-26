import "server-only";
import { resolveDeck, resolveReport } from "./resolve";
import { createReport, setSharing } from "./store";
import {
  previewPath,
  sharePath,
  type DeckInput,
  type PublishedDoc,
  type ReportInput,
  type ReportSummary,
} from "./types";

export function links(summary: ReportSummary, origin: string): PublishedDoc {
  return {
    id: summary.id,
    kind: summary.kind,
    title: summary.title,
    previewUrl: `${origin}${previewPath(summary.id)}`,
    shareUrl: summary.shareToken
      ? `${origin}${sharePath(summary.kind, summary.shareToken)}`
      : null,
  };
}

export async function publish(
  userId: string,
  origin: string,
  input:
    | { kind: "report"; doc: ReportInput; share?: boolean }
    | { kind: "deck"; doc: DeckInput; share?: boolean },
): Promise<PublishedDoc> {
  const created =
    input.kind === "report"
      ? await createReport(userId, {
          kind: "report",
          doc: await resolveReport(input.doc),
        })
      : await createReport(userId, {
          kind: "deck",
          doc: await resolveDeck(input.doc),
        });
  if (!input.share) return links(created, origin);
  const shared = await setSharing(userId, created.id, true);
  return links(shared ?? created, origin);
}
