import {
  type MacrosReportCase,
  type MacrosReportStatusFilter,
  macrosReportStatusFilterSchema,
} from "@repo/schemas/macros";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { cn } from "@repo/ui/utils";
import type { Metadata } from "next";
import Link from "next/link";

import { ApiFailureView } from "@/components/api-failure";
import { FilterNav } from "@/components/filter-nav";
import {
  Barcode,
  ContributorLink,
  ReasonChips,
  ServingLine,
  StateBadge,
  Time,
} from "@/components/moderation";
import { Dot, Empty, PageHeader } from "@/components/page";
import {
  stackAbove,
  stackBody,
  stackCell,
  stackEnd,
  stackFull,
  stackHead,
  stackLead,
  stackLeadEnd,
  stackRow,
  stackRowLink,
  stackTable,
} from "@/components/stack-table";
import { formatCount, plural } from "@/lib/format";
import { macrosApi } from "@/lib/macros-api";
import { caseState, reasonEntries } from "@/lib/moderation";
import { requireOwner } from "@/lib/session";

export const metadata: Metadata = { title: "Reports" };

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const;

function filterHref(status: MacrosReportStatusFilter): string {
  return status === "open" ? "/reports" : `/reports?status=${status}`;
}

const headClass = "text-xs font-normal text-muted-foreground";

export default async function ReportsPage({
  searchParams,
}: PageProps<"/reports">) {
  const params = await searchParams;
  const parsed = macrosReportStatusFilterSchema.safeParse(params.status);
  const status: MacrosReportStatusFilter = parsed.success
    ? parsed.data
    : "open";
  const session = await requireOwner(filterHref(status));
  const result = await macrosApi(session).reports(status);
  const now = Date.now();

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        bordered={false}
        title="Reports"
        meta={
          result.ok ? (
            <span className="tabular-nums">
              {plural(result.data.cases.length, "case")}
            </span>
          ) : null
        }
      />
      <div className="flex flex-col gap-2">
        <div className="border-b">
          <FilterNav
            label="Report status"
            value={status}
            options={FILTERS}
            href={filterHref}
          />
        </div>
        {result.ok ? (
          <CaseTable cases={result.data.cases} now={now} />
        ) : (
          <ApiFailureView failure={result} />
        )}
      </div>
    </div>
  );
}

function CaseTable({ cases, now }: { cases: MacrosReportCase[]; now: number }) {
  if (cases.length === 0) return <Empty />;
  return (
    <Table className={stackTable}>
      <TableHeader className={stackHead}>
        <TableRow className="hover:bg-transparent">
          <TableHead className={cn(headClass, "pl-0")}>Food</TableHead>
          <TableHead className={headClass}>Reasons</TableHead>
          <TableHead className={cn(headClass, "text-right")}>Reports</TableHead>
          <TableHead className={headClass}>Contributor</TableHead>
          <TableHead className={headClass}>State</TableHead>
          <TableHead className={cn(headClass, "pr-0 text-right")}>
            Last report
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className={stackBody}>
        {cases.map((item) => (
          <CaseRow key={item.itemId} item={item} now={now} />
        ))}
      </TableBody>
    </Table>
  );
}

function CaseRow({ item, now }: { item: MacrosReportCase; now: number }) {
  const { food } = item;
  return (
    <TableRow className={cn(stackRow, "align-top")}>
      <TableCell
        className={cn(
          stackCell,
          "w-full min-w-64 py-3 pl-0 whitespace-normal max-md:min-w-0",
          stackLead,
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href={`/reports/${item.itemId}`}
            className={cn(
              "w-fit rounded-sm font-medium break-words text-accent-strong underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
              stackRowLink,
            )}
          >
            {food.name}
          </Link>
          {food.brand || food.barcode ? (
            <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {food.brand ? <span>{food.brand}</span> : null}
              {food.brand && food.barcode ? <Dot /> : null}
              {food.barcode ? <Barcode value={food.barcode} /> : null}
            </div>
          ) : null}
          <ServingLine food={food} className="text-xs text-muted-foreground" />
        </div>
      </TableCell>
      <TableCell
        className={cn(
          stackCell,
          "py-3 whitespace-normal max-md:row-start-2",
          stackFull,
        )}
      >
        <ReasonChips
          entries={reasonEntries(item.byReason)}
          className="max-w-56 max-md:max-w-none"
        />
      </TableCell>
      <TableCell
        className={cn(
          stackCell,
          "py-3 text-right tabular-nums max-md:col-start-1 max-md:row-start-3 max-md:text-left max-md:text-xs max-md:text-muted-foreground",
        )}
      >
        <span className="text-accent-strong max-md:text-foreground">
          {formatCount(item.total)}
        </span>
        <span className="md:hidden">
          {" "}
          {item.total === 1 ? "report" : "reports"}
        </span>
        {item.open && item.openCount !== item.total ? (
          <span className="block text-xs text-muted-foreground max-md:inline">
            <span className="md:hidden">, </span>
            {formatCount(item.openCount)} open
          </span>
        ) : null}
      </TableCell>
      <TableCell
        className={cn(stackCell, "py-3 max-md:col-start-2 max-md:row-start-3")}
      >
        {item.contributor ? (
          <ContributorLink
            contributor={item.contributor}
            className={stackAbove}
          />
        ) : (
          <span className="font-mono text-xs text-muted-foreground">
            {food.source ?? "—"}
          </span>
        )}
      </TableCell>
      <TableCell className={cn(stackCell, "py-3", stackLeadEnd)}>
        <StateBadge state={caseState(item)} />
      </TableCell>
      <TableCell
        className={cn(
          stackCell,
          "py-3 pr-0 text-right text-xs text-muted-foreground max-md:row-start-3",
          stackEnd,
        )}
      >
        <Time iso={item.lastReportedAt} now={now} />
      </TableCell>
    </TableRow>
  );
}
