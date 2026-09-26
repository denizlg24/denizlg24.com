"use client";

import type { FinanceDashboardResponse, WorkJob } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Clock, Repeat } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { fetchWorkJobs } from "../hours/hours-data";
import { useAdmin } from "../provider";
import { FinancePayoutSchedule } from "./finance-payout-schedule";
import { SectionHead } from "./finance-primitives";
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
  payout = false,
}: {
  /** Absent opens the create form. */
  ruleId?: string;
  candidateFingerprint?: string;
  /** A new rule opens as a payout. */
  payout?: boolean;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const backTo = routes.finance.root;

  const [data, setData] = useState<FinanceDashboardResponse | null>(null);
  const [jobs, setJobs] = useState<WorkJob[] | null>(null);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    try {
      const [finance, workJobs] = await Promise.all([
        client.get<FinanceDashboardResponse>("finance"),
        // The tracker is optional: a failure here only empties the job list.
        fetchWorkJobs(client).catch(() => [] as WorkJob[]),
      ]);
      setData(finance);
      setJobs(workJobs);
      setRevision((value) => value + 1);
    } catch {
      toast.error("Failed to load finance data");
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const shell = { icon: ICON, backTo, backLabel: "Finance" } as const;

  if (!data || !jobs) {
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

  const isPayout = Boolean(rule?.payout) || (!rule && payout);

  return (
    <DetailPageShell
      {...shell}
      backTo={isPayout ? routes.finance.payroll : backTo}
      backLabel={isPayout ? "Payroll" : "Finance"}
      title={
        rule ? rule.name : (seed?.name ?? (payout ? "New payout" : "New rule"))
      }
      actions={
        rule?.payout?.source.kind === "hours" ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={routes.hours}>
              <Clock className="size-3.5" />
              Hours
            </Link>
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-8">
        <RuleForm
          accounts={data.accounts}
          seed={seed}
          rule={rule}
          payout={payout}
          jobs={jobs}
          profiles={data.deductionProfiles}
          onSaved={load}
          onDone={() =>
            // An edited payout stays open: its schedule below is what changed.
            rule?.payout
              ? undefined
              : router.push(isPayout ? routes.finance.payroll : backTo)
          }
        />
        {rule?.payout && (
          <section className="space-y-2">
            <SectionHead label="Payouts" />
            <FinancePayoutSchedule ruleId={rule.id} refreshKey={revision} />
          </section>
        )}
      </div>
    </DetailPageShell>
  );
}
