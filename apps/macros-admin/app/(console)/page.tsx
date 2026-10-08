import type { Metadata } from "next";
import Link from "next/link";

import { ApiFailureView } from "@/components/api-failure";
import { EventList } from "@/components/events";
import { PageHeader, Section, type Stat, StatGrid } from "@/components/page";
import { RefreshButton } from "@/components/refresh-button";
import { ReportsChart } from "@/components/reports-chart";
import { DAY_MS, formatAbsolute, formatAge, formatCount } from "@/lib/format";
import { macrosApi } from "@/lib/macros-api";
import { describeEvent } from "@/lib/moderation";
import { requireOwner } from "@/lib/session";
import { resolveSubjectLabels } from "@/lib/subjects";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const session = await requireOwner("/");
  const api = macrosApi(session);
  const result = await api.overview();
  const header = (
    <PageHeader
      bordered={false}
      title="Overview"
      actions={<RefreshButton label="Refresh" />}
    />
  );
  if (!result.ok) {
    return (
      <>
        {header}
        <ApiFailureView failure={result} />
      </>
    );
  }

  const overview = result.data;
  const now = Date.now();
  const labels = await resolveSubjectLabels(api, overview.recentEvents);
  const events = overview.recentEvents.map((event) =>
    describeEvent(event, { ownerId: session.user.id, labels }),
  );
  const oldestAge = overview.oldestOpenReportAt
    ? now - Date.parse(overview.oldestOpenReportAt)
    : null;
  const overdue = oldestAge !== null && oldestAge > DAY_MS;
  const reports30d = overview.reports30d.reduce(
    (sum, day) => sum + day.count,
    0,
  );

  const stats: Stat[] = [
    {
      label: "Open cases",
      value: formatCount(overview.openCases),
      href: "/reports",
    },
    { label: "Open reports", value: formatCount(overview.openReports) },
    {
      label: "Oldest open report",
      value:
        oldestAge === null ? (
          "—"
        ) : (
          <>
            {formatAge(oldestAge)}
            {overdue ? <span className="sr-only">, over 24 hours</span> : null}
          </>
        ),
      sub: overview.oldestOpenReportAt
        ? formatAbsolute(overview.oldestOpenReportAt)
        : undefined,
      emphasis: overdue ? "warning" : undefined,
    },
    {
      label: "Auto-hidden, awaiting review",
      value: formatCount(overview.autoHidden),
      href: overview.autoHidden > 0 ? "/reports" : undefined,
    },
    {
      label: "Contributions, 7 days",
      value: formatCount(overview.contributions7d),
      sub: `${formatCount(overview.contributionsTotal)} total`,
      href: "/contributions",
    },
    {
      label: "Removed",
      value: formatCount(overview.removedTotal),
      href: "/contributions?status=removed",
    },
    {
      label: "Restricted contributors",
      value: formatCount(overview.restrictedContributors),
    },
    { label: "Blocks", value: formatCount(overview.blocks) },
  ];

  return (
    <>
      {header}
      <StatGrid stats={stats} />
      <div className="grid gap-10 xl:grid-cols-5">
        <Section
          title="Reports"
          count={`${formatCount(reports30d)} · 30 days`}
          className="xl:col-span-3"
        >
          <ReportsChart days={overview.reports30d} />
        </Section>
        <Section
          title="Recent activity"
          className="xl:col-span-2"
          actions={
            <Link
              href="/audit"
              className="rounded-sm text-xs text-muted-foreground outline-none transition-colors hover:text-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Audit log
            </Link>
          }
        >
          <EventList events={events} now={now} />
        </Section>
      </div>
    </>
  );
}
