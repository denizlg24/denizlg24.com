import { titleQuerySchema } from "@repo/schemas/stream";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, GridPage } from "@/components/grid/grid-page";
import { queryHeading } from "@/components/grid/query-heading";
import { TitleGrid } from "@/components/grid/title-grid";
import { audienceRules } from "@/lib/audience-rules";
import { queryTitles } from "@/lib/catalog";
import { requireViewer } from "@/lib/viewer";

export const metadata: Metadata = { title: "Browse" };

const PAGE = 42;

export default async function BrowseGridPage({
  searchParams,
}: PageProps<"/browse">) {
  const raw = await searchParams;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && key !== "cursor" && key !== "limit") {
      params[key] = first;
    }
  }
  const { label, ...filters } = params;
  const search = new URLSearchParams(params).toString();
  const viewer = await requireViewer(`/browse${search ? `?${search}` : ""}`);
  const parsed = titleQuerySchema.safeParse({ ...filters, limit: PAGE });
  const query = parsed.success
    ? parsed.data
    : titleQuerySchema.parse({ limit: PAGE });
  const first = await queryTitles(query, audienceRules(viewer.audience));
  const clientQuery = {
    ...(parsed.success ? filters : {}),
    limit: String(PAGE),
  };

  return (
    <GridPage heading={queryHeading(query, label)}>
      {first.titles.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="We couldn't find any titles for this just now. Try a different genre, or search by name."
          action={
            <Link
              href="/search"
              data-nav
              data-nav-autofocus
              className="inline-block rounded-[4px] bg-paper px-6 py-3 font-bold text-ink"
            >
              Search
            </Link>
          }
        />
      ) : (
        <TitleGrid initial={first} query={clientQuery} />
      )}
    </GridPage>
  );
}
