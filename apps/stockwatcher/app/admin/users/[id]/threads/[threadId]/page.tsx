import Link from "next/link";
import { notFound } from "next/navigation";
import { count, duration, tokens, utcStamp } from "@/components/admin/format";
import { JsonBlock, Status } from "@/components/admin/parts";
import { Markdown } from "@/components/assistant/markdown";
import {
  type ChatRun,
  getUser,
  listRuns,
  listUserThreads,
  requireAdmin,
  userFromSlug,
  userSlug,
} from "@/lib/admin";
import { threadIdSchema } from "@/lib/memory";
import { runRetentionDays } from "@/lib/run-retention";

function RunTelemetry({ run }: { run: ChatRun }) {
  return (
    <div className="admin-run" id={`run-${run.id}`}>
      <div className="admin-run-head">
        <time dateTime={run.startedAt}>{utcStamp(run.startedAt)}</time>
        <Status run={run} />
      </div>
      <dl className="kv">
        <dt>Model</dt>
        <dd>{run.model ?? "—"}</dd>
        <dt>Finish</dt>
        <dd>{run.finishReason ?? "—"}</dd>
        <dt>Steps</dt>
        <dd>{count(run.steps)}</dd>
        <dt>Tokens in / out</dt>
        <dd>{tokens(run.inputTokens, run.outputTokens)}</dd>
        <dt>Duration</dt>
        <dd>{duration(run.durationMs)}</dd>
      </dl>
      {run.toolCalls.length ? (
        <ol className="admin-run-tools">
          {run.toolCalls.map((call, index) => (
            <li key={call.id ?? index} data-failed={!call.ok || undefined}>
              <code>{call.name}</code>
              <span className="meta">
                {call.pending ? "client" : call.ok ? "ok" : "failed"}
                {call.ms != null ? ` · ${duration(call.ms)}` : ""}
              </span>
              {call.error ? (
                <p className="admin-error-line">{call.error}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {run.error ? <pre className="admin-failure">{run.error}</pre> : null}
      {run.context ? (
        <details className="admin-more">
          <summary>Request context</summary>
          <JsonBlock label="Context" value={run.context} />
        </details>
      ) : null}
    </div>
  );
}

export default async function AdminThread({
  params,
}: PageProps<"/admin/users/[id]/threads/[threadId]">) {
  await requireAdmin();
  const { id, threadId: rawThread } = await params;
  const userId = userFromSlug(id);
  const threadId = threadIdSchema.safeParse(rawThread);
  if (!userId || !threadId.success) notFound();
  const [user, threads, newestFirst] = await Promise.all([
    getUser(userId),
    listUserThreads(userId),
    listRuns({ userId, threadId: threadId.data, limit: 500 }),
  ]);
  if (!user || !newestFirst.length) notFound();

  const runs = newestFirst.toReversed();
  const userName = user.name ?? "Unknown user";
  const title =
    threads.find((thread) => thread.id === threadId.data)?.title ??
    "Deleted thread";

  return (
    <>
      <nav className="admin-crumbs" aria-label="Breadcrumb">
        <Link href="/admin">Assistant audit</Link>
        <span aria-hidden>/</span>
        <Link href={`/admin/users/${userSlug(userId)}`}>{userName}</Link>
        <span aria-hidden>/</span>
        <span aria-current="page">{title}</span>
      </nav>
      <header className="view-header">
        <div>
          <h1>{title}</h1>
          <p className="meta">
            {count(runs.length)} run{runs.length === 1 ? "" : "s"} · redacted ·
            kept {runRetentionDays} days · <code>{threadId.data}</code>
          </p>
        </div>
      </header>

      <section className="section" aria-labelledby="admin-transcript">
        <ol className="admin-transcript">
          {runs.map((run) => (
            <li key={run.id} className="admin-turn" data-role="assistant">
              <div className="admin-turn-body">
                <div className="admin-parts">
                  <p className="admin-user-text">
                    {run.prompt ?? <span className="muted">No user text</span>}
                  </p>
                  {run.reply ? (
                    <Markdown text={run.reply} streaming={false} />
                  ) : null}
                </div>
              </div>
              <aside className="admin-turn-runs" aria-label="Run telemetry">
                <RunTelemetry run={run} />
              </aside>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
