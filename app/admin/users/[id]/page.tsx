import Link from "next/link";
import { notFound } from "next/navigation";
import { RunTable, threadHref } from "@/components/admin/parts";
import { count, utcStamp } from "@/components/admin/format";
import {
  getUser,
  listRuns,
  listUserThreads,
  requireAdmin,
  userFromSlug,
  workspaceSnapshot,
} from "@/lib/admin";

const runLimit = 100;

export default async function AdminUser({
  params,
}: PageProps<"/admin/users/[id]">) {
  await requireAdmin();
  const userId = userFromSlug((await params).id);
  if (!userId) notFound();
  const [user, threads, runs, snapshot] = await Promise.all([
    getUser(userId),
    listUserThreads(userId),
    listRuns({ userId, limit: runLimit }),
    workspaceSnapshot(userId),
  ]);
  if (!user) notFound();
  const broker = snapshot.broker;

  return (
    <>
      <nav className="admin-crumbs" aria-label="Breadcrumb">
        <Link href="/admin">Assistant audit</Link>
        <span aria-hidden>/</span>
        <span aria-current="page">{user.name ?? "Unknown user"}</span>
      </nav>
      <header className="view-header admin-user-header">
        <div>
          <h1>{user.name ?? "Unknown user"}</h1>
          <p className="meta">
            {user.email ?? "No email on record"}
            {user.demo ? <span className="tag">Preview</span> : null}
          </p>
        </div>
        <dl className="kv admin-user-kv">
          <dt>Last sign-in</dt>
          <dd>{utcStamp(user.lastSeen)}</dd>
          <dt>Last active</dt>
          <dd>{utcStamp(user.lastActive)}</dd>
          <dt>Runs / errors</dt>
          <dd>
            {count(user.runs)} /{" "}
            <span className={user.errors ? "negative" : undefined}>
              {count(user.errors)}
            </span>
          </dd>
        </dl>
      </header>
      <p className="admin-id">
        <span className="kicker">Subject</span> <code>{user.id}</code>
      </p>

      <section className="section" aria-labelledby="admin-workspace">
        <header className="section-head">
          <div>
            <h2 id="admin-workspace">Workspace</h2>
            <p>What the assistant could see when it answered</p>
          </div>
        </header>
        {snapshot.exists ? (
          <div className="stat-row">
            <div className="figure">
              <span className="figure-label">Portfolios</span>
              <strong className="figure-value">{count(snapshot.books)}</strong>
              <span className="figure-sub">
                {count(snapshot.brokerBooks)} from IBKR
              </span>
            </div>
            <div className="figure">
              <span className="figure-label">Trades</span>
              <strong className="figure-value">{count(snapshot.trades)}</strong>
              <span className="figure-sub">ledger entries</span>
            </div>
            <div className="figure">
              <span className="figure-label">Watchlists</span>
              <strong className="figure-value">
                {count(snapshot.watchlists)}
              </strong>
              <span className="figure-sub">
                {count(snapshot.watchedSymbols)} symbols
              </span>
            </div>
            <div className="figure">
              <span className="figure-label">Alerts</span>
              <strong className="figure-value">{count(snapshot.alerts)}</strong>
              <span className="figure-sub">
                {count(snapshot.enabledAlerts)} enabled ·{" "}
                {count(snapshot.channels)} channels
              </span>
            </div>
            <div className="figure">
              <span className="figure-label">Notes</span>
              <strong className="figure-value">{count(snapshot.notes)}</strong>
              <span className="figure-sub">journal</span>
            </div>
            <div className="figure">
              <span className="figure-label">Memories</span>
              <strong className="figure-value">
                {count(snapshot.memories)}
              </strong>
              <span className="figure-sub">assistant memory</span>
            </div>
            <div className="figure">
              <span className="figure-label">Broker link</span>
              <strong
                className={`figure-value${broker && broker.status !== "active" ? " negative" : ""}`}
              >
                {broker ? broker.status : "None"}
              </strong>
              <span className="figure-sub" title={broker?.error ?? undefined}>
                {broker
                  ? broker.error
                    ? broker.error
                    : `Synced ${utcStamp(broker.syncedAt)}`
                  : "IBKR not connected"}
              </span>
            </div>
          </div>
        ) : (
          <div className="empty">
            <strong>No workspace saved.</strong>
            <p>The user has never opened the dashboard.</p>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="admin-threads">
        <header className="section-head">
          <div>
            <h2 id="admin-threads">Threads</h2>
            <p>Saved conversations, most recent first</p>
          </div>
        </header>
        {threads.length ? (
          <div className="admin-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th className="num">Messages</th>
                  <th className="num">Runs</th>
                  <th className="num">Errors</th>
                  <th className="num">Updated</th>
                </tr>
              </thead>
              <tbody>
                {threads.map((thread) => (
                  <tr key={thread.id}>
                    <td className="admin-prompt">
                      <Link href={threadHref(userId, thread.id)}>
                        {thread.title}
                      </Link>
                    </td>
                    <td className="num">{count(thread.messages)}</td>
                    <td className="num">{count(thread.runs)}</td>
                    <td className={`num${thread.errors ? " negative" : ""}`}>
                      {count(thread.errors)}
                    </td>
                    <td className="num">
                      <time dateTime={thread.updatedAt}>
                        {utcStamp(thread.updatedAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>No saved threads.</strong>
            <p>Deleted threads still show up under Runs below.</p>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="admin-user-runs">
        <header className="section-head">
          <div>
            <h2 id="admin-user-runs">Runs</h2>
            <p>Every assistant request, including those in deleted threads</p>
          </div>
        </header>
        {runs.length ? (
          <RunTable runs={runs} showUser={false} label="Runs" />
        ) : (
          <div className="empty">
            <strong>No runs recorded.</strong>
            <p>This user has not used the assistant since recording began.</p>
          </div>
        )}
        {runs.length >= runLimit ? (
          <footer className="section-foot">
            <span>Showing the latest {count(runLimit)} runs</span>
          </footer>
        ) : null}
      </section>
    </>
  );
}
