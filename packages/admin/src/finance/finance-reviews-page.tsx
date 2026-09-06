"use client";

import type { FinanceDashboardResponse } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Check, GitMerge, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DetailPageShell } from "../detail-page-shell";
import { useAdmin } from "../provider";
import { resolveFinanceMatch } from "./finance-data";
import { Empty } from "./finance-primitives";
import { money } from "./finance-series";

const ICON = <GitMerge className="size-4 text-muted-foreground" />;

/**
 * The projection↔bank match queue.
 *
 * It was a tab inside a 1,500-line page, which meant every review shared the
 * width of whatever else that page was rendering. Each row is a comparison of
 * two ledger entries, so the room is the point.
 */
export function FinanceReviewsPage() {
  const { client, routes } = useAdmin();
  const [data, setData] = useState<FinanceDashboardResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await client.get<FinanceDashboardResponse>("finance"));
    } catch {
      toast.error("Failed to load reviews");
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <DetailPageShell
      icon={ICON}
      title={`Match review${reviews.length ? ` · ${reviews.length}` : ""}`}
      backTo={routes.finance.root}
      backLabel="Finance"
    >
      {data === null ? (
        <Empty label="Loading…" />
      ) : reviews.length === 0 ? (
        <Empty label="Queue clear" />
      ) : (
        <div className="divide-y">
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
                className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center"
              >
                <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
                  {[
                    { row: source, tag: "entry" },
                    { row: bank, tag: "bank" },
                  ].map(({ row, tag }) => (
                    <div
                      key={tag}
                      className="flex min-w-0 items-baseline gap-2"
                    >
                      <span className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {tag}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {row?.descriptor ?? "—"}
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {row ? money(row.amountMinor, row.currency) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(review.confidence * 100)}%
                    {drift > 0
                      ? ` · Δ ${money(drift, source?.currency ?? data.monthly.currency)}`
                      : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy === review.id}
                    onClick={() => void resolve(review.id, "reject")}
                  >
                    <X className="size-3" />
                    Reject
                  </Button>
                  <Button
                    size="xs"
                    disabled={busy === review.id}
                    onClick={() => void resolve(review.id, "accept")}
                  >
                    {busy === review.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Check className="size-3" />
                    )}
                    Match
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DetailPageShell>
  );
}
