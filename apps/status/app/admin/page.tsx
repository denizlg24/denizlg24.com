import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  BackupControls,
  Fields,
  IncidentControls,
  MaintenanceForm,
  NewIncident,
} from "@/components/admin-forms";
import { type ChartPoint, ResponseChart } from "@/components/response-chart";
import { Loading } from "@/components/shell";
import { Dot } from "@/components/status";
import { Time } from "@/components/time";
import { adminSession } from "@/lib/auth";
import { catalog } from "@/lib/catalog";
import { formatDuration } from "@/lib/data";
import { collections } from "@/lib/db";
import { freshStatus, healthLabels } from "@/lib/health";
import type { Service } from "@/lib/model";
import { adminAction } from "./actions";
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
  alternates: { canonical: "/admin" },
};
type Query = Record<string, string | string[] | undefined>;
const value = (query: Query, key: string, fallback = "") =>
  typeof query[key] === "string" ? (query[key] as string) : fallback;
const views = [
  "overview",
  "metrics",
  "incidents",
  "backups",
  "maintenance",
  "audit",
];

async function Metrics({
  query,
  services,
}: {
  query: Query;
  services: Service[];
}) {
  const c = await collections();
  const serviceId = value(query, "service", "api");
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
    <section className="admin-section">
      <h2>Response times</h2>
      <form method="get" className="chart-controls">
        <input type="hidden" name="view" value="metrics" />
        <label className="form-field">
          Service
          <select name="service" defaultValue={serviceId}>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          Region
          <select name="region" defaultValue={region}>
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
          </select>
        </label>
        <label className="form-field">
          Range
          <select name="range" defaultValue={range}>
            <option value="hour">Hour</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <button>Apply</button>
      </form>
      <ResponseChart
        points={series}
        from={from}
        to={to}
        step={step}
        outages={incidents.map((incident) => ({
          from: Date.parse(incident.startedAt),
          to: incident.resolvedAt ? Date.parse(incident.resolvedAt) : to,
        }))}
      />
      <dl className="metric-strip">
        <div>
          <dt>Mean response</dt>
          <dd>{formatDuration(stat?.average ?? null)}</dd>
        </div>
        <div>
          <dt>Peak response</dt>
          <dd>{formatDuration(stat?.peak ?? null)}</dd>
        </div>
        <div>
          <dt>Recorded checks</dt>
          <dd>{stat?.count.toLocaleString() ?? "0"}</dd>
        </div>
      </dl>
      <p>
        The graph averages timings within each bucket; the peak above uses
        original observations. Gaps are left open. Incident bands show the
        recorded interruption window.
      </p>
      <h3>Latest health observations</h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th>Probe duration</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((sample) => (
              <tr key={sample._id}>
                <td>
                  <Time value={sample.at.toISOString()} />
                </td>
                <td>{healthLabels[sample.status]}</td>
                <td>{formatDuration(sample.latencyMs)}</td>
                <td>
                  {sample.evidence
                    .map((e) => `${e.source}: ${e.detail ?? e.status}`)
                    .join("; ") || "Checks passed"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
async function Body({
  view,
  services,
  query,
}: {
  view: string;
  services: Service[];
  query: Query;
}) {
  const c = await collections();
  if (view === "metrics") return <Metrics query={query} services={services} />;
  if (view === "incidents") {
    const incidents = await c.incidents
      .find({})
      .sort({ startedAt: -1 })
      .limit(100)
      .toArray();
    return (
      <section className="admin-section">
        <h2>Alerts &amp; incident updates</h2>
        <p>
          Better Stack incidents retain their original failure observations.
          Private notes stay off the public page; public updates are published
          explicitly.
        </p>
        <NewIncident services={services} />
        {incidents.map((incident) => (
          <details className="diagnostic" key={incident._id}>
            <summary>
              <Dot status={incident.resolvedAt ? "operational" : "down"} />
              {incident.title}
              <span>
                <Time value={incident.startedAt} />
              </span>
            </summary>
            <div className="admin-section">
              <p>
                <strong>Reported cause:</strong> {incident.cause}
              </p>
              <p>
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
              <pre className="log-output">
                {incident.evidence
                  .map(
                    (e) =>
                      `${e.at} · ${e.source}\n${e.status} · ${e.detail ?? "No additional detail"}`,
                  )
                  .join("\n\n") ||
                  "No matching observations were available when this incident was imported."}
              </pre>
              <ol className="timeline">
                {incident.updates.toReversed().map((update) => (
                  <li key={update.id}>
                    <div>
                      <strong>
                        {update.visibility} · {update.state}
                      </strong>
                      <span>
                        <Time value={update.at} /> · {update.author}
                      </span>
                    </div>
                    <p>{update.text}</p>
                  </li>
                ))}
              </ol>
              <IncidentControls incident={incident} />
            </div>
          </details>
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
      <section className="admin-section">
        <h2>Maintenance windows</h2>
        <p>
          These windows announce expected impact and mark affected services as
          under maintenance. Checks continue collecting evidence, and Better
          Stack alert delivery remains active.
        </p>
        <details className="diagnostic">
          <summary>
            Schedule a window <span>+</span>
          </summary>
          <MaintenanceForm services={services} />
        </details>
        {windows.map((window) => (
          <details className="diagnostic" key={window._id}>
            <summary>
              {window.title}
              <span>
                {window.cancelledAt ? (
                  "Cancelled"
                ) : (
                  <Time value={window.startsAt} />
                )}
              </span>
            </summary>
            <MaintenanceForm services={services} window={window} />
            {!window.cancelledAt ? (
              <form action={adminAction}>
                <Fields operation="maintenance-cancel" id={window._id} />
                <button>Cancel window</button>
              </form>
            ) : null}
          </details>
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
      <section className="admin-section">
        <h2>Backup operations</h2>
        <p>
          Cloud jobs use the existing scheduler. Recovery jobs are dispatched to
          the authenticated host agent, which starts the existing guarded backup
          services.
        </p>
        {backups.length ? (
          backups.map((backup) => (
            <details className="diagnostic" key={backup.id}>
              <summary>
                {backup.name}
                <span>{backup.status}</span>
              </summary>
              <div className="admin-section">
                <p>
                  Last successful: <Time value={backup.lastSuccessAt} /> · Next:{" "}
                  <Time value={backup.nextRunAt} />
                </p>
                <p>
                  {backup.verification ??
                    "No separate verification evidence was reported."}
                </p>
                <pre className="log-output">
                  {backup.detail ?? "No output recorded."}
                </pre>
                <BackupControls backup={backup} />
              </div>
            </details>
          ))
        ) : (
          <p className="empty-state">
            No backup reports yet. Connect the Cloud collector and host
            reporters to enable controls.
          </p>
        )}
        <div className="admin-section">
          <h3>Host commands</h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Job</th>
                  <th>Action</th>
                  <th>State</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {commands.map((command) => (
                  <tr key={command._id}>
                    <td>
                      <Time value={command.createdAt.toISOString()} />
                    </td>
                    <td>
                      {command.profile} · {command.job}
                    </td>
                    <td>{command.action}</td>
                    <td>{command.state}</td>
                    <td>{command.detail ?? "Awaiting host"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <h3>Recent runs</h3>
        {runs.map((run) => (
          <details className="diagnostic" key={run._id}>
            <summary>
              {run.name}
              <span>
                <Time value={run.startedAt} /> · {run.status}
              </span>
            </summary>
            <p className="log-output">{run.verification}</p>
            <pre className="log-output">
              {run.detail ?? "No output recorded."}
            </pre>
          </details>
        ))}
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
      <section className="admin-section">
        <h2>Admin audit log</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry._id}>
                  <td>
                    <Time value={entry.at.toISOString()} />
                  </td>
                  <td>{entry.actor}</td>
                  <td>{entry.action}</td>
                  <td>{entry.target}</td>
                  <td>{entry.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
  const snapshot = await c.snapshots.findOne({ _id: "latest" });
  return (
    <section className="admin-section">
      <h2>Collector &amp; dependency health</h2>
      <p>
        Last collection: <Time value={snapshot?.at ?? null} />
      </p>
      {snapshot?.warnings.length ? (
        <div className="editorial-note">
          {snapshot.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {services.map((service) => (
        <details className="diagnostic" key={service.id}>
          <summary>
            <Dot
              status={freshStatus(
                service.status,
                service.checkedAt,
                Date.now(),
              )}
            />
            {service.name}
            <span>
              {
                healthLabels[
                  freshStatus(service.status, service.checkedAt, Date.now())
                ]
              }{" "}
              · {formatDuration(service.latencyMs)}
            </span>
          </summary>
          <pre>
            {service.evidence
              .map(
                (evidence) =>
                  `${evidence.source} · ${evidence.at}\n${evidence.status} · ${formatDuration(evidence.latencyMs)}\n${evidence.detail ?? "No error reported"}`,
              )
              .join("\n\n") || "No observations recorded."}
          </pre>
        </details>
      ))}
    </section>
  );
}
async function Admin({ searchParams }: { searchParams: Promise<Query> }) {
  let session: Awaited<ReturnType<typeof adminSession>>;
  try {
    session = await adminSession();
  } catch {
    return (
      <section className="admin-login">
        <h1>Authentication is unavailable.</h1>
        <p>
          The public status page is still available. Your Cloud session has not
          been signed out; try again when the API is reachable.
        </p>
        <Link href="/">View service status</Link>
      </section>
    );
  }
  if (!session)
    return (
      <section className="admin-login">
        <h1>Sign in</h1>
        <div className="form-actions">
          <a
            className="primary-button"
            style={{ padding: "10px 16px", borderRadius: 5 }}
            href="https://cloud.denizlg24.com/login"
          >
            Sign in to Cloud ↗
          </a>
          <a href="https://forge.denizlg24.com/login">Sign in to Forge ↗</a>
        </div>
        <p>
          <Link prefetch={false} href="/admin">
            Already signed in? Check session ↻
          </Link>
        </p>
      </section>
    );
  const query = await searchParams;
  const requested = value(query, "view", "overview");
  const view = views.includes(requested) ? requested : "overview";
  let services = catalog;
  try {
    const c = await collections();
    services =
      (await c.snapshots.findOne({ _id: "latest" }))?.services ?? catalog;
  } catch {
    return (
      <section className="admin-login">
        <h1>The monitoring store is unavailable.</h1>
        <p>
          Check the managed MongoDB connection and run the status database setup
          script. No operational controls have been executed.
        </p>
      </section>
    );
  }
  return (
    <>
      <div className="admin-top">
        <h1>Behind the status.</h1>
        <span>{session.username} · Administrator</span>
      </div>
      <nav className="admin-nav" aria-label="Admin navigation">
        {views.map((name) => (
          <Link
            prefetch={false}
            key={name}
            href={`/admin?view=${name}`}
            aria-current={view === name ? "page" : undefined}
          >
            {name[0]!.toUpperCase() + name.slice(1)}
          </Link>
        ))}
      </nav>
      {value(query, "notice") ? (
        <p role="status" className="action-feedback">
          {value(query, "notice").slice(0, 300)}
        </p>
      ) : null}
      <Body view={view} services={services} query={query} />
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
