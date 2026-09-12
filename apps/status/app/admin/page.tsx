import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { NativeSelect } from "@repo/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { cn } from "@repo/ui/utils";
import { ArrowUpRight, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ActionButton,
  AdminFeedback,
  AdminForm,
  PendingNewItem,
} from "@/components/admin-feedback";
import {
  BackupControls,
  Disclosure,
  Field,
  Fields,
  IncidentControls,
  Log,
  MaintenanceForm,
  NewIncident,
  ResetHistory,
} from "@/components/admin-forms";
import { AdminNavigation } from "@/components/admin-navigation";
import { ServicesAdmin } from "@/components/admin-services";
import { SourcesAdmin } from "@/components/admin-sources";
import { BackupFacts } from "@/components/backup-facts";
import { Dot, healthText } from "@/components/health";
import { Live } from "@/components/live";
import { type ChartPoint, ResponseChart } from "@/components/response-chart";
import { Loading, SectionHeading } from "@/components/shell";
import { Time } from "@/components/time";
import { adminSession, authLoginHref } from "@/lib/auth";
import { backupStateLabel } from "@/lib/backups";
import { catalog, drJobs } from "@/lib/catalog";
import {
  orderedGroups,
  resolveServices,
  type StatusConfig,
} from "@/lib/config";
import { formatDuration } from "@/lib/data";
import { collections, statusConfig } from "@/lib/db";
import { freshStatus, healthLabels } from "@/lib/health";
import type { Service } from "@/lib/model";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
  alternates: { canonical: "/admin" },
};
type Query = Record<string, string | string[] | undefined>;
const value = (query: Query, key: string, fallback = "") =>
  typeof query[key] === "string" ? (query[key] as string) : fallback;
const views = [
  ["overview", "Overview"],
  ["services", "Services"],
  ["sources", "Better Stack"],
  ["metrics", "Metrics"],
  ["incidents", "Incidents"],
  ["backups", "Backups"],
  ["maintenance", "Maintenance"],
  ["audit", "Audit"],
] as const;
type View = (typeof views)[number][0];

async function Metrics({
  query,
  services,
}: {
  query: Query;
  services: Service[];
}) {
  const c = await collections();
  const serviceId = value(query, "service", services[0]?.id ?? "api");
  const region = value(query, "region", "eu").slice(0, 40);
  const range = value(query, "range", "day");
  const duration =
    (
      {
        hour: 3600_000,
        day: 86400_000,
        week: 7 * 86400_000,
        month: 30 * 86400_000,
      } as Record<string, number>
    )[range] ?? 86400_000;
  const step =
    duration <= 3600_000
      ? 30_000
      : duration <= 86400_000
        ? 300_000
        : duration <= 7 * 86400_000
          ? 1800_000
          : 7200_000;
  const to = Date.now();
  const from = to - duration;
  const [regions, series, summary, incidents, checks] = await Promise.all([
    c.timings.distinct("region", { serviceId }),
    c.timings
      .aggregate<ChartPoint>(
        [
          {
            $match: {
              serviceId,
              region,
              at: { $gte: new Date(from), $lte: new Date(to) },
            },
          },
          {
            $group: {
              _id: {
                $multiply: [
                  { $floor: { $divide: [{ $toLong: "$at" }, step] } },
                  step,
                ],
              },
              total: { $avg: "$total" },
              peak: { $max: "$total" },
              dns: { $avg: "$dns" },
              connection: { $avg: "$connection" },
              tls: { $avg: "$tls" },
              transfer: { $avg: "$transfer" },
            },
          },
          {
            $project: {
              _id: 0,
              at: "$_id",
              total: 1,
              peak: 1,
              dns: 1,
              connection: 1,
              tls: 1,
              transfer: 1,
            },
          },
          { $sort: { at: 1 } },
        ],
        { maxTimeMS: 8000 },
      )
      .toArray(),
    c.timings
      .aggregate<{ count: number; average: number; peak: number }>(
        [
          {
            $match: {
              serviceId,
              region,
              at: { $gte: new Date(from), $lte: new Date(to) },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              average: { $avg: "$total" },
              peak: { $max: "$total" },
            },
          },
        ],
        { maxTimeMS: 8000 },
      )
      .toArray(),
    c.incidents
      .find({
        serviceIds: serviceId,
        startedAt: { $lte: new Date(to).toISOString() },
        $or: [
          { resolvedAt: null },
          { resolvedAt: { $gte: new Date(from).toISOString() } },
        ],
      })
      .toArray(),
    c.samples
      .find({ serviceId, at: { $gte: new Date(from) } })
      .sort({ at: -1 })
      .limit(60)
      .toArray(),
  ]);
  const stat = summary[0];
  return (
    <section>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value="metrics" />
        <Field label="Service">
          <NativeSelect name="service" defaultValue={serviceId}>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Region">
          <NativeSelect name="region" defaultValue={region}>
            {Array.from(new Set([region, ...regions]))
              .sort()
              .map((item) => (
                <option key={item} value={item}>
                  {(
                    {
                      eu: "Europe",
                      us: "United States",
                      as: "Asia",
                      au: "Australia",
                    } as Record<string, string>
                  )[item] ?? item}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="Range">
          <NativeSelect name="range" defaultValue={range}>
            <option value="hour">Hour</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </NativeSelect>
        </Field>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
      </form>
      <ResponseChart
        points={series}
        from={from}
        to={to}
        outages={incidents.map((incident) => ({
          from: Date.parse(incident.startedAt),
          to: incident.resolvedAt ? Date.parse(incident.resolvedAt) : to,
        }))}
      />
      <dl className="my-6 grid grid-cols-3 gap-4 border-y py-4">
        {[
          ["Mean response", formatDuration(stat?.average ?? null)],
          ["Peak response", formatDuration(stat?.peak ?? null)],
          ["Recorded checks", stat?.count.toLocaleString() ?? "0"],
        ].map(([term, figure]) => (
          <div key={term}>
            <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {term}
            </dt>
            <dd className="mt-1 font-mono text-lg tabular-nums">{figure}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-8 text-xs text-muted-foreground">
        Bands are averaged within each bucket; the peak above uses original
        observations. Shaded regions are recorded interruption windows.
      </p>
      <SectionHeading title="Latest health observations" />
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Probe</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map((sample) => (
              <TableRow key={sample._id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  <Time value={sample.at.toISOString()} />
                </TableCell>
                <TableCell className={healthText[sample.status]}>
                  {healthLabels[sample.status]}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatDuration(sample.latencyMs)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {sample.evidence
                    .map((e) => `${e.source}: ${e.detail ?? e.status}`)
                    .join("; ") || "Checks passed"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
async function Body({
  view,
  services,
  config,
  query,
}: {
  view: View;
  services: Service[];
  config: StatusConfig;
  query: Query;
}) {
  const c = await collections();
  const groups = orderedGroups(config);
  if (view === "metrics") return <Metrics query={query} services={services} />;
  if (view === "services")
    return (
      <ServicesAdmin services={services} config={config} groups={groups} />
    );
  if (view === "sources") {
    const sources = await c.sources
      .find({})
      .sort({ kind: 1, name: 1 })
      .toArray();
    return (
      <SourcesAdmin
        sources={sources}
        config={config}
        services={services}
        groups={groups}
      />
    );
  }
  if (view === "incidents") {
    const incidents = await c.incidents
      .find({})
      .sort({ startedAt: -1 })
      .limit(100)
      .toArray();
    return (
      <section>
        <p className="mb-6 text-sm text-muted-foreground">
          Better Stack incidents retain their original failure observations.
          Private notes stay off the public page.
        </p>
        <NewIncident services={services} />
        <PendingNewItem kind="incident" />
        {incidents.map((incident) => (
          <Disclosure
            key={incident._id}
            id={incident._id}
            summary={
              <>
                <Dot status={incident.resolvedAt ? "operational" : "down"} />
                <span className="truncate">{incident.title}</span>
              </>
            }
            note={<Time value={incident.startedAt} />}
          >
            <p className="text-sm">
              <span className="text-muted-foreground">Reported cause: </span>
              {incident.cause}
            </p>
            <p className="text-xs text-muted-foreground">
              {incident.betterStackId
                ? `Better Stack incident ${incident.betterStackId}`
                : "Manually reported"}{" "}
              ·{" "}
              {incident.resolvedAt
                ? "Resolved"
                : incident.acknowledgedAt
                  ? "Acknowledged"
                  : "Unacknowledged"}
            </p>
            <Log>
              {incident.evidence
                .map(
                  (e) =>
                    `${e.at} · ${e.source}\n${e.status} · ${e.detail ?? "No additional detail"}`,
                )
                .join("\n\n") ||
                "No matching observations were available when this incident was imported."}
            </Log>
            {incident.updates.length ? (
              <ol className="space-y-3 border-l pl-4">
                {incident.updates.toReversed().map((update) => (
                  <li key={update.id}>
                    <div className="flex items-baseline gap-2 text-xs">
                      <Badge
                        variant={
                          update.visibility === "public"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {update.visibility}
                      </Badge>
                      <strong className="font-medium">{update.state}</strong>
                      <span className="text-muted-foreground">
                        <Time value={update.at} /> · {update.author}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {update.text}
                    </p>
                  </li>
                ))}
              </ol>
            ) : null}
            <IncidentControls incident={incident} />
          </Disclosure>
        ))}
      </section>
    );
  }
  if (view === "maintenance") {
    const windows = await c.maintenance
      .find({})
      .sort({ startsAt: -1 })
      .limit(100)
      .toArray();
    return (
      <section>
        <p className="mb-6 text-sm text-muted-foreground">
          A window marks affected services as under maintenance. Checks keep
          collecting evidence and Better Stack alerting stays active.
        </p>
        <Disclosure
          summary={<span className="font-medium">Schedule a window</span>}
        >
          <MaintenanceForm services={services} />
          <PendingNewItem kind="maintenance" />
        </Disclosure>
        {windows.map((window) => (
          <Disclosure
            key={window._id}
            id={window._id}
            summary={<span className="truncate">{window.title}</span>}
            note={
              window.cancelledAt ? (
                "Cancelled"
              ) : (
                <Time value={window.startsAt} />
              )
            }
          >
            <MaintenanceForm services={services} window={window} />
            {!window.cancelledAt ? (
              <AdminForm targetId={window._id}>
                <Fields operation="maintenance-cancel" id={window._id} />
                <ActionButton type="submit" size="sm" variant="ghost">
                  Cancel window
                </ActionButton>
              </AdminForm>
            ) : null}
          </Disclosure>
        ))}
      </section>
    );
  }
  if (view === "backups") {
    const [backups, runs, commands] = await Promise.all([
      c.backups.find({}).sort({ provider: 1, name: 1 }).toArray(),
      c.backupRuns.find({}).sort({ startedAt: -1 }).limit(50).toArray(),
      c.commands.find({}).sort({ createdAt: -1 }).limit(30).toArray(),
    ]);
    return (
      <section>
        <p className="mb-6 text-sm text-muted-foreground">
          Cloud jobs use the existing scheduler. Recovery jobs are dispatched to
          the authenticated host agent.
        </p>
        <p className="mb-6 text-sm text-muted-foreground">
          Backup completion, offsite publication and a proven restore are
          separate checks. A metadata simulation needs no VPS. Full recovery
          readiness requires a target restore, measured recovery time, and
          successful cutover and rollback rehearsals.
        </p>
        <Live
          at={new Date().toISOString()}
          generatedAt={new Date().toISOString()}
        >
          {backups.length ? (
            backups.map((backup) => (
              <Disclosure
                key={backup.id}
                id={backup.id}
                summary={
                  <span className="truncate">
                    {drJobs.find((job) => job.id === backup.id)?.name ??
                      backup.name}
                  </span>
                }
                note={backupStateLabel(backup, Date.now())}
              >
                <p className="text-xs text-muted-foreground">
                  Last successful: <Time value={backup.lastSuccessAt} /> · Next:{" "}
                  <Time value={backup.nextRunAt} />
                </p>
                <BackupFacts backup={backup} />
                <p className="text-sm text-muted-foreground">
                  {backup.verification ??
                    "No separate verification evidence was reported."}
                </p>
                <Log>
                  {backup.detail
                    ?.split("\n")
                    .filter((line) => !line.startsWith("DR_STATUS "))
                    .join("\n") || "No output recorded."}
                </Log>
                <BackupControls backup={backup} />
              </Disclosure>
            ))
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No backup reports yet.
            </p>
          )}
        </Live>
        <div className="mt-10">
          <SectionHeading title="Host commands" />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commands.map((command) => (
                  <TableRow key={command._id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <Time value={command.createdAt.toISOString()} />
                    </TableCell>
                    <TableCell>
                      {command.profile} · {command.job}
                    </TableCell>
                    <TableCell>{command.action}</TableCell>
                    <TableCell>{command.state}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {command.detail ?? "Awaiting host"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="mt-10">
          <SectionHeading title="Recent runs" />
          {runs.map((run) => (
            <Disclosure
              key={run._id}
              summary={
                <span className="truncate">
                  {drJobs.find((job) => job.id === run.id)?.name ?? run.name}
                </span>
              }
              note={
                <>
                  <Time value={run.startedAt} /> · {run.status}
                </>
              }
            >
              <BackupFacts backup={run} />
              {run.verification ? (
                <p className="text-sm text-muted-foreground">
                  {run.verification}
                </p>
              ) : null}
              <Log>
                {run.detail
                  ?.split("\n")
                  .filter((line) => !line.startsWith("DR_STATUS "))
                  .join("\n") || "No output recorded."}
              </Log>
            </Disclosure>
          ))}
        </div>
      </section>
    );
  }
  if (view === "audit") {
    const entries = await c.audit
      .find({})
      .sort({ at: -1 })
      .limit(100)
      .toArray();
    return (
      <section className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry._id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  <Time value={entry.at.toISOString()} />
                </TableCell>
                <TableCell>{entry.actor}</TableCell>
                <TableCell className="font-mono text-xs">
                  {entry.action}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {entry.target}
                </TableCell>
                <TableCell
                  className={cn(
                    entry.outcome.startsWith("failed") && healthText.down,
                  )}
                >
                  {entry.outcome}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    );
  }
  const snapshot = await c.snapshots.findOne({ _id: "latest" });
  const now = Date.now();
  return (
    <section>
      <p className="mb-6 text-sm text-muted-foreground">
        Last collection: <Time value={snapshot?.at ?? null} />
      </p>
      {snapshot?.warnings.length ? (
        <div className="mb-6 space-y-1 border-l-2 border-status-warning bg-status-warning/5 px-4 py-3">
          {snapshot.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 text-sm">
              <TriangleAlert
                aria-hidden
                className="mt-0.5 size-3.5 shrink-0 text-status-warning"
              />
              {warning}
            </p>
          ))}
        </div>
      ) : null}
      {(snapshot?.services ?? services).map((service) => {
        const status = freshStatus(service.status, service.checkedAt, now);
        return (
          <Disclosure
            key={service.id}
            summary={
              <>
                <Dot status={status} />
                <span className="truncate">{service.name}</span>
              </>
            }
            note={`${healthLabels[status]} · ${formatDuration(service.latencyMs)}`}
          >
            <Log>
              {service.evidence
                .map(
                  (evidence) =>
                    `${evidence.source} · ${evidence.at}\n${evidence.status} · ${formatDuration(evidence.latencyMs)}\n${evidence.detail ?? "No error reported"}`,
                )
                .join("\n\n") || "No observations recorded."}
            </Log>
          </Disclosure>
        );
      })}
      <div className="mt-10">
        <SectionHeading title="Danger zone" />
        <ResetHistory />
      </div>
    </section>
  );
}
async function Admin({ searchParams }: { searchParams: Promise<Query> }) {
  let session: Awaited<ReturnType<typeof adminSession>>;
  try {
    session = await adminSession();
  } catch {
    return (
      <section className="py-16">
        <h1 className="text-xl font-medium">Authentication is unavailable.</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          The public status page is still available. Your Cloud session has not
          been signed out; try again when the API is reachable.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1 text-sm underline underline-offset-4"
        >
          View service status
        </Link>
      </section>
    );
  }
  if (!session)
    return (
      <section className="py-16">
        <h1 className="text-xl font-medium">Sign in</h1>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button asChild size="sm">
            <a href={authLoginHref()}>
              Sign in
              <ArrowUpRight aria-hidden />
            </a>
          </Button>
        </div>
        <Link
          prefetch={false}
          href="/admin"
          className="mt-5 inline-block text-sm text-muted-foreground underline underline-offset-4"
        >
          Already signed in? Check session
        </Link>
      </section>
    );
  const query = await searchParams;
  const requested = value(query, "view", "overview");
  const view = (
    views.some(([name]) => name === requested) ? requested : "overview"
  ) as View;
  let services: Service[];
  let config: StatusConfig;
  try {
    const c = await collections();
    const [snapshot, stored] = await Promise.all([
      c.snapshots.findOne({ _id: "latest" }),
      statusConfig(),
    ]);
    config = stored;
    // The admin lists hidden tiles too — that is the only way to unhide one.
    services = resolveServices(snapshot?.services ?? catalog, {
      ...stored,
      services: Object.fromEntries(
        Object.entries(stored.services).map(([id, override]) => [
          id,
          { ...override, visible: true },
        ]),
      ),
    });
  } catch {
    return (
      <section className="py-16">
        <h1 className="text-xl font-medium">
          The monitoring store is unavailable.
        </h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Check the managed MongoDB connection and run the status database setup
          script. No operational controls have been executed.
        </p>
      </section>
    );
  }
  return (
    <>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl tracking-tight">Behind the status.</h1>
        <span className="text-xs text-muted-foreground">
          {session.username} · Administrator
        </span>
      </div>
      <AdminNavigation view={view} views={views} />
      {value(query, "notice") ? (
        <p
          role="status"
          className="bg-surface mb-6 rounded-md px-4 py-3 text-sm"
        >
          {value(query, "notice").slice(0, 300)}
        </p>
      ) : null}
      <AdminFeedback key={view}>
        <Body view={view} services={services} config={config} query={query} />
      </AdminFeedback>
    </>
  );
}
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <Admin searchParams={searchParams} />
    </Suspense>
  );
}
