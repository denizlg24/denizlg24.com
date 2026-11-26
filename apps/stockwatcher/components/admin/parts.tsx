import Link from "next/link";
import type { ChatRun, RunStatus, RunWithUser } from "@/lib/admin";
import { runStatus, userSlug } from "@/lib/admin";
import { count, duration, tokens, utcStamp } from "./format";

const statusLabel: Record<RunStatus, string> = {
  error: "Error",
  warn: "Tool error",
  ok: "OK",
};

export function Status({ run }: { run: ChatRun }) {
  const status = runStatus(run);
  return (
    <span className="status admin-status" data-status={status}>
      {statusLabel[status]}
    </span>
  );
}

export function ToolNames({ run }: { run: ChatRun }) {
  if (!run.toolCalls.length) return <span className="muted">—</span>;
  const grouped = new Map<string, { calls: number; failed: number }>();
  for (const call of run.toolCalls) {
    const entry = grouped.get(call.name) ?? { calls: 0, failed: 0 };
    entry.calls += 1;
    if (!call.ok) entry.failed += 1;
    grouped.set(call.name, entry);
  }
  return (
    <span className="admin-tools">
      {[...grouped].map(([name, entry]) => (
        <span
          key={name}
          className="admin-tool-name"
          data-failed={entry.failed > 0 || undefined}
          title={
            entry.failed
              ? `${entry.failed} of ${entry.calls} failed`
              : `${entry.calls} call${entry.calls === 1 ? "" : "s"}`
          }
        >
          {name}
          {entry.calls > 1 ? <small>×{entry.calls}</small> : null}
        </span>
      ))}
    </span>
  );
}

export const threadHref = (userId: string, threadId: string, runId?: string) =>
  `/admin/users/${userSlug(userId)}/threads/${encodeURIComponent(threadId)}${runId ? `#run-${runId}` : ""}`;

export function RunTable({
  runs,
  showUser,
  label,
}: {
  runs: RunWithUser[];
  showUser: boolean;
  label: string;
}) {
  return (
    <div className="admin-scroll">
      <table className="data-table admin-runs" aria-label={label}>
        <thead>
          <tr>
            <th>Started</th>
            {showUser ? <th>User</th> : null}
            <th>Prompt</th>
            <th>Tools</th>
            <th className="num">Steps</th>
            <th className="num">Tokens in / out</th>
            <th className="num">Duration</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} data-status={runStatus(run)}>
              <td className="admin-time">
                <time dateTime={run.startedAt}>{utcStamp(run.startedAt)}</time>
              </td>
              {showUser ? (
                <td className="admin-user-cell">
                  <Link href={`/admin/users/${userSlug(run.userId)}`}>
                    {run.userName ?? run.userId}
                  </Link>
                </td>
              ) : null}
              <td className="admin-prompt">
                <Link
                  href={threadHref(run.userId, run.threadId, run.id)}
                  title={run.prompt ?? undefined}
                >
                  {run.prompt || <span className="muted">No user text</span>}
                </Link>
                {run.error ? (
                  <span className="admin-error-line" title={run.error}>
                    {run.error}
                  </span>
                ) : null}
              </td>
              <td>
                <ToolNames run={run} />
              </td>
              <td className="num">{count(run.steps)}</td>
              <td className="num">
                {tokens(run.inputTokens, run.outputTokens)}
              </td>
              <td className="num">{duration(run.durationMs)}</td>
              <td>
                <Status run={run} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const jsonLimit = 4_000;

function pretty(value: unknown) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = pretty(value);
  const head = text.slice(0, jsonLimit);
  const rest = text.slice(jsonLimit);
  return (
    <div className="admin-json">
      <span className="admin-json-label">
        {label}
        <small>{count(text.length)} chars</small>
      </span>
      <pre>{head}</pre>
      {rest ? (
        <details className="admin-more">
          <summary>Show remaining {count(rest.length)} chars</summary>
          <pre>{rest}</pre>
        </details>
      ) : null}
    </div>
  );
}
