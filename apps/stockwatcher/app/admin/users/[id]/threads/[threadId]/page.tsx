import { getToolName, isToolUIPart } from "ai";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  count,
  duration,
  tokens,
  utcClock,
  utcStamp,
} from "@/components/admin/format";
import { JsonBlock, Status, ToolNames } from "@/components/admin/parts";
import { Markdown } from "@/components/assistant/markdown";
import {
  type ChatRun,
  getUser,
  listRuns,
  requireAdmin,
  type ToolCallRecord,
  userFromSlug,
  userSlug,
} from "@/lib/admin";
import { getThread, type StoredMessage, threadIdSchema } from "@/lib/memory";

type Part = StoredMessage["parts"][number];

function ToolPart({
  part,
  timing,
}: {
  part: Extract<Part, { toolCallId: string }>;
  timing: ToolCallRecord | undefined;
}) {
  const failed =
    part.state === "output-error" || part.state === "output-denied";
  return (
    <details
      className="admin-tool"
      data-failed={failed || undefined}
      open={failed}
    >
      <summary>
        <code className="admin-tool-title">{getToolName(part)}</code>
        <span className="tag" data-state={part.state}>
          {part.state}
        </span>
        {timing?.ms != null ? (
          <span className="meta">{duration(timing.ms)}</span>
        ) : null}
        <span className="meta admin-tool-id">{part.toolCallId}</span>
      </summary>
      <div className="admin-tool-body">
        {part.state === "output-error" ? (
          <pre className="admin-failure" role="note">
            {part.errorText}
          </pre>
        ) : null}
        {part.state === "output-denied" ? (
          <p className="admin-failure">Tool call was denied.</p>
        ) : null}
        <JsonBlock label="Input" value={part.input} />
        {part.state === "output-available" ? (
          <JsonBlock label="Output" value={part.output} />
        ) : null}
      </div>
    </details>
  );
}

function MessagePart({
  part,
  role,
  timings,
}: {
  part: Part;
  role: StoredMessage["role"];
  timings: ReadonlyMap<string, ToolCallRecord>;
}) {
  if (isToolUIPart(part))
    return <ToolPart part={part} timing={timings.get(part.toolCallId)} />;
  switch (part.type) {
    case "text":
      return role === "assistant" ? (
        <Markdown text={part.text} streaming={false} />
      ) : (
        <p className="admin-user-text">{part.text}</p>
      );
    case "reasoning":
      return (
        <details className="admin-reasoning">
          <summary>Reasoning · {count(part.text.length)} chars</summary>
          <pre>{part.text}</pre>
        </details>
      );
    case "step-start":
      return <hr className="admin-step" aria-label="New step" />;
    case "source-url":
      return (
        <p className="meta admin-source">
          Source:{" "}
          <a href={part.url} target="_blank" rel="noopener noreferrer nofollow">
            {part.title ?? part.url}
          </a>
        </p>
      );
    default:
      return <JsonBlock label={part.type} value={part} />;
  }
}

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
  const [user, thread, newestFirst] = await Promise.all([
    getUser(userId),
    getThread(userId, threadId.data),
    listRuns({ userId, threadId: threadId.data, limit: 500 }),
  ]);
  if (!user || (!thread && !newestFirst.length)) notFound();

  const runs = newestFirst.toReversed();
  const messages = thread?.messages ?? [];
  const messageIds = new Set(messages.map((message) => message.id));
  const runsByMessage = new Map<string, ChatRun[]>();
  for (const run of runs)
    if (run.messageId && messageIds.has(run.messageId))
      runsByMessage.set(run.messageId, [
        ...(runsByMessage.get(run.messageId) ?? []),
        run,
      ]);
  const unmatched = runs.filter(
    (run) => !run.messageId || !messageIds.has(run.messageId),
  );
  const timings = new Map(
    runs.flatMap((run) =>
      run.toolCalls.flatMap((call) =>
        call.id ? [[call.id, call] as const] : [],
      ),
    ),
  );
  const userName = user.name ?? "Unknown user";
  const title = thread?.title ?? "Deleted thread";

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
            {thread
              ? `${count(messages.length)} messages · `
              : "Thread deleted by the user; runs are kept · "}
            {count(runs.length)} recorded run{runs.length === 1 ? "" : "s"} ·{" "}
            <code>{threadId.data}</code>
          </p>
        </div>
      </header>

      {unmatched.length ? (
        <section className="section" aria-labelledby="admin-unmatched">
          <header className="section-head">
            <div>
              <h2 id="admin-unmatched">Runs without a saved reply</h2>
              <p>
                Failed before the thread was saved, trimmed from the thread, or
                recorded before the thread was deleted
              </p>
            </div>
          </header>
          <ol className="ruled-list admin-unmatched">
            {unmatched.map((run) => (
              <li key={run.id}>
                <div className="admin-unmatched-prompt">
                  <span className="kicker">Prompt</span>
                  <p>{run.prompt ?? "No user text"}</p>
                  <ToolNames run={run} />
                  {run.reply ? (
                    <details className="admin-more">
                      <summary>Reply · {count(run.reply.length)} chars</summary>
                      <Markdown text={run.reply} streaming={false} />
                    </details>
                  ) : null}
                </div>
                <RunTelemetry run={run} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {thread ? (
        <section className="section" aria-labelledby="admin-transcript">
          <header className="section-head">
            <div>
              <h2 id="admin-transcript">Transcript</h2>
              <p>
                As saved after the latest reply · telemetry beside each turn
              </p>
            </div>
          </header>
          <ol className="admin-transcript">
            {messages.map((message) => {
              const turnRuns = runsByMessage.get(message.id) ?? [];
              return (
                <li
                  key={message.id}
                  className="admin-turn"
                  data-role={message.role}
                >
                  <div className="admin-turn-body">
                    <div className="admin-turn-head">
                      <span className="kicker">{message.role}</span>
                      <span className="meta">{message.id}</span>
                      {turnRuns[0] ? (
                        <span className="meta">
                          {utcClock(turnRuns[0].startedAt)}
                        </span>
                      ) : null}
                    </div>
                    <div className="admin-parts">
                      {message.parts.map((part, index) => (
                        <MessagePart
                          key={index}
                          part={part}
                          role={message.role}
                          timings={timings}
                        />
                      ))}
                    </div>
                  </div>
                  {message.role === "assistant" ? (
                    <aside
                      className="admin-turn-runs"
                      aria-label="Run telemetry"
                    >
                      {turnRuns.length ? (
                        turnRuns.map((run) => (
                          <RunTelemetry key={run.id} run={run} />
                        ))
                      ) : (
                        <p className="meta">No run recorded for this reply.</p>
                      )}
                    </aside>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </>
  );
}
