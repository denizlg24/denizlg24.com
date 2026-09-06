"use client";

import type { FinanceDashboardResponse } from "@repo/schemas";
import { Receipt } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";
import { EntryDetail, EntryForm } from "./finance-entry-form";

const ICON = <Receipt className="size-4 text-muted-foreground" />;

/**
 * One ledger entry, or the form that creates one.
 *
 * The create form carries three tabs (manual, expected, quick) that were
 * competing for a 28rem sheet; the detail carries the match section, which is a
 * comparison of two rows and needs to show both.
 */
export function FinanceEntryPage({
  entryId,
}: {
  /** Absent opens the create form. */
  entryId?: string;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const backTo = routes.finance.root;

  const [data, setData] = useState<FinanceDashboardResponse | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await client.get<FinanceDashboardResponse>("finance"));
    } catch {
      toast.error("Failed to load finance data");
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const shell = { icon: ICON, backTo, backLabel: "Finance" } as const;

  if (!data) {
    return <DetailPageSkeleton {...shell} title="Entry" rows={2} />;
  }

  if (!entryId) {
    return (
      <DetailPageShell {...shell} title="New entry">
        <EntryForm
          accounts={data.accounts}
          categories={data.categories}
          onCreated={load}
          onDone={() => router.push(backTo)}
        />
      </DetailPageShell>
    );
  }

  const entry = data.ledger.find((row) => row.id === entryId) ?? null;
  if (!entry) {
    return (
      <DetailNotFound
        {...shell}
        title="Entry not found"
        message="This ledger row could not be loaded."
      />
    );
  }

  return (
    <DetailPageShell {...shell} title={entry.descriptor}>
      <EntryDetail
        entry={entry}
        accounts={data.accounts}
        categories={data.categories}
        ledger={data.ledger}
        onClose={() => router.push(backTo)}
        onSaved={load}
      />
    </DetailPageShell>
  );
}
