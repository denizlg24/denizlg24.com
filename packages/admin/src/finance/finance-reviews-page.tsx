"use client";

import type { FinanceDashboardResponse } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { List } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Check, GitMerge, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DetailPageShell } from "../detail-page-shell";
import { useAdmin } from "../provider";
import { resolveFinanceMatch } from "./finance-data";

import { money } from "./finance-series";

const ICON = <GitMerge />;

/**
 * The projection↔bank match queue.
 *
 * It was a tab inside a 1,500-line page, which meant every review shared the
 * width of whatever else that page was rendering. Each row is a comparison of
 * two ledger entries, so the room is the point.
 */
export function FinanceReviewsPage({
  embedded = false,
  dashboard,
  onReload,
}: {
  embedded?: boolean;
  dashboard?: FinanceDashboardResponse;
  onReload?: () => Promise<void>;
}) {
  const { client, routes } = useAdmin();
  const [loadedData, setLoadedData] = useState<FinanceDashboardResponse | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const data = dashboard ?? loadedData;

  const load = useCallback(async () => {
    try {
      if (onReload) await onReload();
      else setLoadedData(await client.get<FinanceDashboardResponse>("finance"));
      setFailed(false);
    } catch {
      setFailed(true);
      toast.error("Failed to load reviews");
    }
  }, [client, onReload]);

  useEffect(() => {
    if (dashboard) return;
    void load();
  }, [dashboard, load]);

  const ledger = useMemo(
    () => new Map((data?.ledger ?? []).map((row) => [row.id, row])),
    [data],
  );

  async function resolve(reviewId: string, action: "accept" | "reject") {
    setBusy(reviewId);
    try {
      await resolveFinanceMatch(client, reviewId, action);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  const reviews = data?.matchReviews ?? [];

  const content =
    data === null ? (
      failed ? (
        <EmptyState
          icon={<GitMerge />}
          label="Reviews unavailable"
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      )
    ) : reviews.length === 0 ? (
      <EmptyState icon={<GitMerge />} label="Queue clear" />
    ) : (
      <List divided>
        {reviews.map((review) => {
          const source = ledger.get(review.sourceLedgerId);
          const bank = ledger.get(review.candidateBankLedgerId);
          const drift =
            source && bank
              ? Math.abs(source.amountMinor - bank.amountMinor)
              : 0;
          return (
            <div
              key={review.id}
              role="listitem"
              className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center"
            >
              <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
                {[
                  { row: source, tag: "entry" },
                  { row: bank, tag: "bank" },
                ].map(({ row, tag }) => (
                  <div key={tag} className="flex min-w-0 items-baseline gap-2">
                    <span className="w-10 shrink-0 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      {tag}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-accent-strong">
                      {row?.descriptor ?? "—"}
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-accent-strong">
                      {row ? money(row.amountMinor, row.currency) : "—"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(review.confidence * 100)}%
                  {drift > 0
                    ? ` · Δ ${money(drift, source?.currency ?? data.monthly.currency)}`
                    : ""}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === review.id}
                  onClick={() => void resolve(review.id, "reject")}
                >
                  <X />
                  Reject
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === review.id}
                  onClick={() => void resolve(review.id, "accept")}
                >
                  {busy === review.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  Match
                </Button>
              </div>
            </div>
          );
        })}
      </List>
    );

  if (embedded) {
    return (
      <Section title="Match review" count={reviews.length || undefined}>
        {content}
      </Section>
    );
  }

  return (
    <DetailPageShell
      icon={ICON}
      title="Match review"
      backTo={routes.finance.root}
      backLabel="Finance"
    >
      <Section title="Queue" count={reviews.length}>
        {content}
      </Section>
    </DetailPageShell>
  );
}
