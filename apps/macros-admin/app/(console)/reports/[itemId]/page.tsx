import {
  type MacrosReportCase,
  macrosFoodReportReasonLabels,
} from "@repo/schemas/macros";
import { Badge } from "@repo/ui/badge";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";

import { ApiFailureView } from "@/components/api-failure";
import { EventList } from "@/components/events";
import { Facts } from "@/components/facts";
import { CaseActions } from "@/components/food-actions";
import {
  Barcode,
  ContributorLink,
  StateBadge,
  Time,
} from "@/components/moderation";
import { Dot, Empty, PageHeader, Section, StatGrid } from "@/components/page";
import { formatCount, formatGrams, shortId } from "@/lib/format";
import { macrosApi } from "@/lib/macros-api";
import {
  actorLabel,
  caseState,
  describeEvent,
  type EventView,
  isAutoHidden,
  REASON_SHORT_LABELS,
  reasonEntries,
} from "@/lib/moderation";
import { requireOwner } from "@/lib/session";
import { resolveSubjectLabels } from "@/lib/subjects";

export const metadata: Metadata = { title: "Report" };

const BACK = { href: "/reports", label: "Reports" };

export default async function ReportPage({
  params,
}: PageProps<"/reports/[itemId]">) {
  const { itemId } = await params;
  if (!z.uuid().safeParse(itemId).success) notFound();
  const session = await requireOwner(`/reports/${itemId}`);
  const api = macrosApi(session);
  const [found, history] = await Promise.all([
    api.report(itemId),
    api.events({ subject: itemId, limit: 50 }),
  ]);
  const now = Date.now();
  const ownerId = session.user.id;

  const seed = new Map<string, string>();
  if (found.ok) seed.set(itemId, found.data.food.name);
  const rawEvents = history.ok ? history.data.events : [];
  const labels = await resolveSubjectLabels(api, rawEvents, seed);
  const events = rawEvents.map((event) =>
    describeEvent(event, { ownerId, labels }),
  );

  if (!found.ok) {
    if (found.status !== 404) {
      return (
        <>
          <PageHeader back={BACK} title="Report" />
          <ApiFailureView failure={found} />
        </>
      );
    }
    // A food removed outside a report has history but no case.
    if (events.length === 0) notFound();
    return (
      <>
        <PageHeader
          back={BACK}
          title={labels.get(itemId) ?? `Food ${shortId(itemId)}`}
          meta={<span>0 reports</span>}
        />
        <Section title="History" count={events.length}>
          <EventList events={events} now={now} showSubject={false} />
        </Section>
      </>
    );
  }

  return (
    <CaseView item={found.data} events={events} now={now} ownerId={ownerId} />
  );
}

function CaseView({
  item,
  events,
  now,
  ownerId,
}: {
  item: MacrosReportCase;
  events: EventView[];
  now: number;
  ownerId: string;
}) {
  const { food } = item;
  const autoHidden = isAutoHidden(food, item.open);
  const meta: ReactNode[] = [];
  if (food.brand) meta.push(<span key="brand">{food.brand}</span>);
  if (food.barcode) meta.push(<Barcode key="barcode" value={food.barcode} />);

  return (
    <>
      <PageHeader
        back={BACK}
        title={food.name}
        meta={
          <>
            <StateBadge state={caseState(item)} className="mr-1" />
            {meta.flatMap((node, index) =>
              index === 0 ? [node] : [<Dot key={`dot-${index}`} />, node],
            )}
          </>
        }
        actions={
          <CaseActions
            itemId={item.itemId}
            name={food.name}
            openCount={item.openCount}
            removed={food.removed}
            autoHidden={autoHidden}
          />
        }
      />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-10">
          <Section title="Per serving" count={food.servingLabel ?? undefined}>
            <StatGrid
              ruled={false}
              className="pt-1"
              stats={[
                {
                  label: "Energy",
                  value: (
                    <Amount
                      value={food.caloriesPerServing}
                      unit="kcal"
                      integer
                    />
                  ),
                },
                {
                  label: "Protein",
                  value: <Amount value={food.proteinPerServing} unit="g" />,
                },
                {
                  label: "Carbs",
                  value: <Amount value={food.carbsPerServing} unit="g" />,
                },
                {
                  label: "Fat",
                  value: <Amount value={food.fatPerServing} unit="g" />,
                },
              ]}
            />
          </Section>
          <Section title="Reasons" count={formatCount(item.total)}>
            <ReasonBreakdown item={item} />
          </Section>
          <Section title="Notes" count={item.notes.length}>
            {item.notes.length === 0 ? (
              <Empty />
            ) : (
              <ol className="flex flex-col">
                {item.notes.map((note, index) => (
                  <li
                    key={`${note.createdAt}-${index}`}
                    className="flex flex-col gap-1.5 border-b py-3 last:border-b-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge
                        variant="outline"
                        className="font-normal text-foreground"
                      >
                        {REASON_SHORT_LABELS[note.reason]}
                      </Badge>
                      <Time
                        iso={note.createdAt}
                        now={now}
                        className="text-xs text-muted-foreground"
                      />
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {note.note}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
        <aside className="flex min-w-0 flex-col gap-10">
          <Section title="Case">
            <Facts
              items={[
                {
                  label: "Contributor",
                  value: item.contributor ? (
                    <ContributorLink contributor={item.contributor} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
                },
                {
                  label: "Reports",
                  value: item.open
                    ? `${formatCount(item.total)} · ${formatCount(item.openCount)} open`
                    : formatCount(item.total),
                },
                {
                  label: "First",
                  value: <Time iso={item.firstReportedAt} now={now} />,
                },
                {
                  label: "Last",
                  value: <Time iso={item.lastReportedAt} now={now} />,
                },
                ...(food.removed
                  ? [
                      {
                        label: "Removed",
                        value: food.removedAt ? (
                          <Time iso={food.removedAt} now={now} />
                        ) : (
                          "yes"
                        ),
                      },
                      {
                        label: "By",
                        value: food.removedBy
                          ? actorLabel(food.removedBy, ownerId)
                          : "—",
                      },
                      ...(food.removedReason
                        ? [
                            {
                              label: "Reason",
                              value: (
                                <span className="text-xs">
                                  {food.removedReason}
                                </span>
                              ),
                            },
                          ]
                        : []),
                    ]
                  : []),
                {
                  label: "Source",
                  value: (
                    <span className="font-mono text-xs">
                      {food.source ?? "—"}
                    </span>
                  ),
                },
                {
                  label: "Item",
                  value: (
                    <span className="font-mono text-xs" title={item.itemId}>
                      {shortId(item.itemId)}
                    </span>
                  ),
                },
              ]}
            />
          </Section>
          <Section title="History" count={events.length}>
            <EventList events={events} now={now} showSubject={false} />
          </Section>
        </aside>
      </div>
    </>
  );
}

function Amount({
  value,
  unit,
  integer = false,
}: {
  value: number | null;
  unit: string;
  integer?: boolean;
}) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {integer ? formatCount(value) : formatGrams(value)}
      <span className="ml-1 text-sm font-normal text-muted-foreground">
        {unit}
      </span>
    </>
  );
}

function ReasonBreakdown({ item }: { item: MacrosReportCase }) {
  const entries = reasonEntries(item.byReason);
  if (entries.length === 0) return <Empty />;
  const max = Math.max(...entries.map(([, count]) => count));
  return (
    <ul className="flex flex-col">
      {entries.map(([reason, count]) => (
        <li
          key={reason}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-b py-2.5 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)_2.5rem]"
        >
          <span className="truncate text-sm">
            {macrosFoodReportReasonLabels[reason]}
          </span>
          <span className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-border/40 sm:col-span-1 sm:row-start-auto">
            <span
              className="block h-full rounded-full bg-foreground/70"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </span>
          <span className="col-start-2 row-start-1 text-right text-sm tabular-nums text-accent-strong sm:col-start-auto sm:row-start-auto">
            {formatCount(count)}
          </span>
        </li>
      ))}
    </ul>
  );
}
