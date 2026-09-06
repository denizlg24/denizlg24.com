"use client";

import type { FinanceDashboardResponse } from "@repo/schemas";
import { Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";
import { RuleForm } from "./finance-rule-form";

const ICON = <Repeat className="size-4 text-muted-foreground" />;

export function FinanceRulePage({
  ruleId,
  /**
   * A detected candidate to seed a new rule from, by merchant fingerprint.
   *
   * The candidate itself is a computed row on the dashboard rather than a
   * stored record, so the URL carries its identity and the page looks it up
   * again — passing the whole object through a query string would go stale the
   * moment the ledger moved.
   */
  candidateFingerprint,
}: {
  /** Absent opens the create form. */
  ruleId?: string;
  candidateFingerprint?: string;
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
    return <DetailPageSkeleton {...shell} title="Rule" rows={2} />;
  }

  const rule = ruleId
    ? (data.recurringRules.find((row) => row.id === ruleId) ?? null)
    : null;

  if (ruleId && !rule) {
    return (
      <DetailNotFound
        {...shell}
        title="Rule not found"
        message="This recurring rule could not be loaded."
      />
    );
  }

  const seed = candidateFingerprint
    ? (data.recurringCandidates.find(
        (row) => row.merchantFingerprint === candidateFingerprint,
      ) ?? null)
    : null;

  return (
    <DetailPageShell
      {...shell}
      title={rule ? rule.name : (seed?.name ?? "New rule")}
    >
      <RuleForm
        accounts={data.accounts}
        seed={seed}
        rule={rule}
        onSaved={load}
        onDone={() => router.push(backTo)}
      />
    </DetailPageShell>
  );
}
