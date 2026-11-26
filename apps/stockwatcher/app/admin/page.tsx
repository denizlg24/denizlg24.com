import Link from "next/link";
import { RunTable } from "@/components/admin/parts";
import {
  count,
  duration,
  percentOf,
  utcStamp,
} from "@/components/admin/format";
import {
  listRuns,
  listUsers,
  overview,
  requireAdmin,
  userSlug,
} from "@/lib/admin";

export default async function AdminOverview() {
  await requireAdmin();
  const [summary, { users, hiddenPreview }, runs] = await Promise.all([
    overview(7),
    listUsers(),
    listRuns({ limit: 60 }),
  ]);
  const errorRate = percentOf(summary.errors, summary.runs);

  return (
    <>
      <header className="view-header">
        <h1>Assistant audit</h1>
        <p className="meta">
          Every user’s assistant runs, threads and tool calls
        </p>
      </header>

      <section className="section" aria-labelledby="admin-summary">
        <header className="section-head">
          <div>
            <h2 id="admin-summary">Last 7 days</h2>
            <p>Runs started since {utcStamp(summary.since)} UTC</p>
          </div>
        </header>
        <div className="stat-row">
          <div className="figure">
            <span className="figure-label">Users</span>
            <strong className="figure-value">{count(summary.users)}</strong>
            <span className="figure-sub">all time</span>
          </div>
          <div className="figure">
            <span className="figure-label">Threads</span>
            <strong className="figure-value">{count(summary.threads)}</strong>
            <span className="figure-sub">saved now</span>
          </div>
          <div className="figure">
            <span className="figure-label">Runs</span>
            <strong className="figure-value">{count(summary.runs)}</strong>
            <span className="figure-sub">7 days</span>
          </div>
          <div className="figure">
            <span className="figure-label">Error rate</span>
            <strong
              className={`figure-value${summary.errors ? " negative" : ""}`}
            >
              {errorRate}
            </strong>
            <span className="figure-sub">
              {count(summary.errors)} failed run
              {summary.errors === 1 ? "" : "s"}
            </span>
          </div>
          <div className="figure">
            <span className="figure-label">Avg duration</span>
            <strong className="figure-value">
              {duration(summary.avgDurationMs)}
            </strong>
            <span className="figure-sub">request to last token</span>
          </div>
          <div className="figure">
            <span className="figure-label">Avg tokens</span>
            <strong className="figure-value">{count(summary.avgTokens)}</strong>
            <span className="figure-sub">input + output per run</span>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="admin-users">
        <header className="section-head">
          <div>
            <h2 id="admin-users">Users</h2>
            <p>Most recently active first</p>
          </div>
        </header>
        {users.length ? (
          <div className="admin-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th className="num">Threads</th>
                  <th className="num">Runs</th>
                  <th className="num">Errors</th>
                  <th className="num">Last active</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="admin-user-cell">
                      <Link href={`/admin/users/${userSlug(user.id)}`}>
                        {user.name ?? "Unknown user"}
                      </Link>
                      {user.demo ? <span className="tag">Preview</span> : null}
                    </td>
                    <td className="muted">{user.email ?? "—"}</td>
                    <td className="num">{count(user.threads)}</td>
                    <td className="num">{count(user.runs)}</td>
                    <td className={`num${user.errors ? " negative" : ""}`}>
                      {count(user.errors)}
                    </td>
                    <td className="num">
                      <time dateTime={user.lastActive ?? undefined}>
                        {utcStamp(user.lastActive)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>No users yet.</strong>
            <p>Accounts appear here after their first sign-in.</p>
          </div>
        )}
        <footer className="section-foot">
          <span>Names come from the latest Deniz Cloud sign-in</span>
          {hiddenPreview ? (
            <span>
              {count(hiddenPreview)} preview session
              {hiddenPreview === 1 ? "" : "s"} without assistant activity hidden
            </span>
          ) : null}
        </footer>
      </section>

      <section className="section" aria-labelledby="admin-runs">
        <header className="section-head">
          <div>
            <h2 id="admin-runs">Recent runs</h2>
            <p>One row per assistant request, newest first</p>
          </div>
        </header>
        {runs.length ? (
          <RunTable runs={runs} showUser label="Recent runs" />
        ) : (
          <div className="empty">
            <strong>No assistant runs recorded.</strong>
            <p>
              Runs are recorded from the first assistant request after this
              deploy.
            </p>
          </div>
        )}
        <footer className="section-foot">
          <span>Latest {count(runs.length)} runs across all users</span>
          <span>Runs stay after their thread is deleted</span>
        </footer>
      </section>
    </>
  );
}
