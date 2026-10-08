"use client";

import type {
  MacrosContribution,
  MacrosContributionsQuery,
} from "@repo/schemas/macros";
import { Button } from "@repo/ui/button";
import { Spinner } from "@repo/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { cn } from "@repo/ui/utils";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { RemoveFoodButton, RestoreButton } from "@/components/food-actions";
import {
  Barcode,
  ContributorLink,
  StateBadge,
  Time,
} from "@/components/moderation";
import { Dot, Empty } from "@/components/page";
import {
  stackAbove,
  stackBody,
  stackCell,
  stackEnd,
  stackHead,
  stackLead,
  stackLeadEnd,
  stackRow,
  stackRowLink,
  stackTable,
} from "@/components/stack-table";
import { loadContributionsAction } from "@/lib/actions";
import { formatCount } from "@/lib/format";
import { contributionState } from "@/lib/moderation";

type ContributionFilter = Omit<MacrosContributionsQuery, "cursor" | "limit">;

const headClass = "text-xs font-normal text-muted-foreground";

export function ContributionList({
  initial,
  initialCursor,
  query,
  pageSize,
  now,
  showContributor = true,
}: {
  initial: MacrosContribution[];
  initialCursor: string | null;
  query: ContributionFilter;
  pageSize: number;
  now: number;
  showContributor?: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, startLoading] = useTransition();

  function loadMore() {
    if (!cursor) return;
    startLoading(async () => {
      const result = await loadContributionsAction({
        ...query,
        cursor,
        limit: pageSize,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setItems((current) => {
        const seen = new Set(current.map((item) => item.itemId));
        return [
          ...current,
          ...result.data.contributions.filter((item) => !seen.has(item.itemId)),
        ];
      });
      setCursor(result.data.nextCursor);
    });
  }

  function update(itemId: string, patch: Partial<MacrosContribution>) {
    setItems((current) =>
      current.map((item) =>
        item.itemId === itemId ? { ...item, ...patch } : item,
      ),
    );
  }

  if (items.length === 0) return <Empty />;

  return (
    <div className="flex flex-col gap-4">
      <Table className={stackTable}>
        <TableHeader className={stackHead}>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(headClass, "pl-0")}>Food</TableHead>
            {showContributor ? (
              <TableHead className={headClass}>Contributor</TableHead>
            ) : null}
            <TableHead className={cn(headClass, "text-right")}>
              Reports
            </TableHead>
            <TableHead className={headClass}>State</TableHead>
            <TableHead className={headClass}>Added</TableHead>
            <TableHead className={cn(headClass, "pr-0 text-right")}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className={stackBody}>
          {items.map((item) => (
            <ContributionRow
              key={item.itemId}
              item={item}
              now={now}
              showContributor={showContributor}
              onRemoved={(reason) =>
                update(item.itemId, {
                  removed: true,
                  removedBy: null,
                  removedReason: reason ?? null,
                })
              }
              onRestored={() =>
                update(item.itemId, {
                  removed: false,
                  removedBy: null,
                  removedReason: null,
                })
              }
            />
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatCount(items.length)} shown</span>
        {cursor ? (
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={loadMore}
          >
            {loading ? <Spinner className="size-3.5" /> : null}
            Load more
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ContributionRow({
  item,
  now,
  showContributor,
  onRemoved,
  onRestored,
}: {
  item: MacrosContribution;
  now: number;
  showContributor: boolean;
  onRemoved: (reason: string | undefined) => void;
  onRestored: () => void;
}) {
  const reported = item.reportCount > 0;
  return (
    <TableRow className={cn(stackRow, "align-top")}>
      <TableCell
        className={cn(
          stackCell,
          "w-full min-w-56 py-3 pl-0 whitespace-normal max-md:min-w-0",
          stackLead,
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          {reported ? (
            <Link
              href={`/reports/${item.itemId}`}
              className={cn(
                "w-fit rounded-sm font-medium break-words text-accent-strong underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
                stackRowLink,
              )}
            >
              {item.name}
            </Link>
          ) : (
            <span className="font-medium break-words text-accent-strong">
              {item.name}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {item.brand ? (
              <>
                <span>{item.brand}</span>
                <Dot />
              </>
            ) : null}
            <Barcode value={item.barcode} />
          </div>
          {item.removed && item.removedReason ? (
            <p className="text-xs break-words text-danger">
              {item.removedReason}
            </p>
          ) : null}
        </div>
      </TableCell>
      {showContributor ? (
        <TableCell
          className={cn(
            stackCell,
            "py-3 max-md:col-start-1 max-md:row-start-2",
          )}
        >
          <ContributorLink
            contributor={item.contributor}
            className={stackAbove}
          />
        </TableCell>
      ) : null}
      <TableCell
        className={cn(
          stackCell,
          "py-3 text-right tabular-nums max-md:row-start-2 max-md:text-xs max-md:text-muted-foreground",
          showContributor ? "max-md:col-start-2" : "max-md:col-start-1",
        )}
      >
        <span
          className={cn(
            reported ? "text-accent-strong" : "text-muted-foreground",
          )}
        >
          {formatCount(item.reportCount)}
        </span>
        <span className="md:hidden">
          {item.reportCount === 1 ? " report" : " reports"}
        </span>
      </TableCell>
      <TableCell className={cn(stackCell, "py-3", stackLeadEnd)}>
        <StateBadge state={contributionState(item)} />
      </TableCell>
      <TableCell
        className={cn(
          stackCell,
          "py-3 text-xs text-muted-foreground max-md:row-start-2",
          showContributor ? "max-md:col-start-3" : "max-md:col-start-2",
        )}
      >
        <Time iso={item.createdAt} now={now} />
      </TableCell>
      <TableCell
        className={cn(
          stackCell,
          "py-2 pr-0 text-right max-md:row-start-2",
          stackEnd,
          stackAbove,
        )}
      >
        {item.removed ? (
          <RestoreButton itemId={item.itemId} size="xs" onDone={onRestored} />
        ) : (
          <RemoveFoodButton
            itemId={item.itemId}
            name={item.name}
            size="xs"
            onDone={onRemoved}
          />
        )}
      </TableCell>
    </TableRow>
  );
}
