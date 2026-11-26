import "server-only";
import type { Metadata } from "next";
import { connection } from "next/server";
import { cache } from "react";
import { getByShareToken } from "./store";
import type { ReportRecord } from "./types";

export const sharedDoc = cache(async (token: string) => {
  await connection();
  return getByShareToken(token);
});

const robots = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false },
};

export function sharedMetadata(found: ReportRecord | null): Metadata {
  if (!found) return { title: "Link unavailable · Stockwatcher", robots };
  const description =
    found.doc.subtitle ??
    (found.kind === "deck"
      ? `A ${found.doc.slides.length}-slide deck shared from Stockwatcher.`
      : "A market report shared from Stockwatcher.");
  const title = `${found.doc.title} · Stockwatcher`;
  return {
    title,
    description,
    robots,
    referrer: "no-referrer",
    openGraph: {
      type: "article",
      siteName: "Stockwatcher",
      title: found.doc.title,
      description,
      publishedTime: found.doc.date,
      authors: found.doc.author ? [found.doc.author] : undefined,
    },
    twitter: { card: "summary", title: found.doc.title, description },
  };
}
