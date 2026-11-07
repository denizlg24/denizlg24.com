"use client";

import type {
  CodingRun,
  Finding,
  RunResult,
  SprintDetail,
  SprintSlot,
} from "@repo/schemas";
import { isLiveCodingRunStatus } from "@repo/schemas";
import { Shimmer } from "@repo/ui/ai-elements/shimmer";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListGroupLabel, ListRow } from "@repo/ui/list";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { Marker, MarkerContent } from "@repo/ui/marker";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { ScrollArea } from "@repo/ui/scroll-area";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import type { ChatStatus } from "ai";
import { formatDistanceStrict } from "date-fns";
import { GitMerge, RotateCcw, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";
import {
  type AgentMessageHandlers,
  AgentMessageList,
} from "../agent/agent-messages";
import { formatCost, formatTokenCount } from "../agent/agent-parts";
import { AdminApiError } from "../client";
import { useAdmin } from "../provider";
import { RunConfigSummary } from "./run-composer";
import {
  canRetrySlot,
  errorMessage,
  FAILURE_LABEL,
  formatAbsolute,
  githubUrl,
  RUN_STATUS_TONE,
  SEVERITY_ORDER,
  SEVERITY_TONE,
  SLOT_KIND_LABEL,
  shortSha,
} from "./sprint-meta";
import { SPRINT_ICON } from "./sprints-page";

/** The runner flushes transcript batches every ≤ 2 s. */
const LIVE_POLL_MS = 2_500;

const NO_HANDLERS: AgentMessageHandlers = { onApproval: () => undefined };

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-xs hover:underline"
    >
      {children}
    </a>
  );
}

function Strings({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5 font-mono text-xs">
      {items.map((item, index) => (
        <li key={index} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Findings({
  findings,
  repo,
  sha,
}: {
  findings: Finding[];
  repo: string;
  sha: string | undefined;
}) {
  if (findings.length === 0) {
    return <span className="text-xs text-muted-foreground">No findings</span>;
  }
  return (
    <List>
      {SEVERITY_ORDER.map((severity) => {
        const group = findings.filter(
          (finding) => finding.severity === severity,
        );
        if (group.length === 0) return null;
        return (
          <Fragment key={severity}>
            <ListGroupLabel className="flex items-center">
              {severity}
              <span className="ml-auto tabular-nums">{group.length}</span>
            </ListGroupLabel>
            {group.map((finding) => {
              const location = finding.file
                ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
                : null;
              return (
                <ListRow
                  key={finding.id}
                  className="items-start"
                  leading={
                    <StatusDot
                      tone={SEVERITY_TONE[finding.severity]}
                      label={finding.severity}
                      className="mt-1.5"
                    />
                  }
                  title={finding.title}
                  description={
                    location && sha ? (
                      <a
                        href={githubUrl(
                          repo,
                          `/blob/${sha}/${finding.file}${
                            finding.line ? `#L${finding.line}` : ""
                          }`,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono hover:underline"
                      >
                        {location}
                      </a>
                    ) : (
                      (location ?? undefined)
                    )
                  }
                  meta={<span className="font-mono">{finding.id}</span>}
                />
              );
            })}
          </Fragment>
        );
      })}
    </List>
  );
}

function ResultBody({ result, run }: { result: RunResult; run: CodingRun }) {
  const summary = (
    <MarkdownRenderer content={result.summary} className="text-sm" />
  );
  switch (result.kind) {
    case "implement":
      return (
        <>
          {summary}
          <Properties>
            <Property label="Areas" className="items-start">
              <Strings items={result.changedAreas} />
            </Property>
            <Property label="Tests" className="items-start">
              <Strings items={result.testsRun} />
            </Property>
          </Properties>
          {result.notes ? (
            <MarkdownRenderer
              content={result.notes}
              className="text-xs text-muted-foreground"
            />
          ) : null}
        </>
      );
    case "review":
      return (
        <>
          <Badge variant={result.verdict === "approve" ? "good" : "warning"}>
            {result.verdict}
          </Badge>
          {summary}
          <Findings
            findings={result.findings}
            repo={run.repo}
            sha={run.headSha ?? run.baseSha}
          />
        </>
      );
    case "fix-review":
      return (
        <>
          {summary}
          <Properties>
            <Property label="Addressed" className="items-start">
              <Strings items={result.addressed} />
            </Property>
          </Properties>
          {result.declined.length > 0 ? (
            <List>
              <ListGroupLabel>Declined</ListGroupLabel>
              {result.declined.map((declined) => (
                <ListRow
                  key={declined.id}
                  title={<span className="font-mono">{declined.id}</span>}
                  description={declined.reason}
                />
              ))}
            </List>
          ) : null}
        </>
      );
    case "release":
      return (
        <>
          {summary}
          <Properties>
            <Property label="Version">
              <span className="font-mono">{result.version ?? "—"}</span>
            </Property>
            <Property label="CI gate">
              {result.ciRequired ? "required" : "none"}
            </Property>
            <Property label="Steps" className="items-start">
              <Strings items={result.steps} />
            </Property>
          </Properties>
        </>
      );
    case "custom":
      return summary;
  }
}

/** Review findings carry long detail; the full text sits under each title. */
function FindingDetails({ result }: { result: RunResult | undefined }) {
  if (result?.kind !== "review") return null;
  const detailed = result.findings.filter((finding) => finding.detail.trim());
  if (detailed.length === 0) return null;
  return (
    <Section title="Details" count={detailed.length}>
      <div className="flex flex-col gap-4">
        {detailed.map((finding) => (
          <div key={finding.id} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-xs">
              <StatusDot
                tone={SEVERITY_TONE[finding.severity]}
                label={finding.severity}
              />
              <span className="font-mono text-muted-foreground">
                {finding.id}
              </span>
              <span className="font-medium text-accent-strong">
                {finding.title}
              </span>
            </span>
            <MarkdownRenderer
              content={finding.detail}
              className="text-xs text-muted-foreground"
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

function RunFacts({ run, now }: { run: CodingRun; now: number }) {
  const duration = run.startedAt
    ? formatDistanceStrict(
        run.completedAt ? new Date(run.completedAt) : new Date(now),
        new Date(run.startedAt),
      )
    : null;
  const usage = run.usage;
  const head = shortSha(run.headSha);
  const base = shortSha(run.baseSha);
  return (
    <Properties>
      <Property label="Kind">{SLOT_KIND_LABEL[run.kind]}</Property>
      <Property label="Started">
        <span className="tabular-nums">
          {run.startedAt ? formatAbsolute(run.startedAt) : "—"}
        </span>
      </Property>
      <Property label="Duration">
        <span className="tabular-nums">{duration ?? "—"}</span>
      </Property>
      <Property label="Usage">
        {usage ? (
          <span className="tabular-nums">
            {formatTokenCount(usage.inputTokens)} in ·{" "}
            {formatTokenCount(usage.outputTokens)} out ·{" "}
            {formatTokenCount(usage.cacheReadTokens)} cached ·{" "}
            {usage.notional ? "~" : ""}
            {formatCost(usage.costUsd)}
          </span>
        ) : (
          "—"
        )}
      </Property>
      <Property label="Branch">
        <ExternalLink href={githubUrl(run.repo, `/tree/${run.branch}`)}>
          {run.branch}
        </ExternalLink>
      </Property>
      <Property label="Commits">
        {base && run.baseSha ? (
          <span className="flex items-center gap-1.5">
            <ExternalLink href={githubUrl(run.repo, `/commit/${run.baseSha}`)}>
              {base}
            </ExternalLink>
            {head && run.headSha ? (
              <>
                <span className="text-muted-foreground">…</span>
                <ExternalLink
                  href={githubUrl(
                    run.repo,
                    `/compare/${run.baseSha}...${run.headSha}`,
                  )}
                >
                  {head}
                </ExternalLink>
              </>
            ) : null}
          </span>
        ) : (
          "—"
        )}
      </Property>
      <Property label="PR">
        {run.prUrl ? (
          <ExternalLink href={run.prUrl}>
            {run.prUrl.replace(/^https:\/\/github\.com\//, "")}
          </ExternalLink>
        ) : (
          "—"
        )}
      </Property>
      <Property label="CI">
        {run.ci ? (
          <span className="flex items-center gap-2">
            <Badge
              variant={
                run.ci.state === "success"
                  ? "good"
                  : run.ci.state === "failure"
                    ? "critical"
                    : "warning"
              }
            >
              {run.ci.state}
            </Badge>
            {run.ci.url ? (
              <ExternalLink href={run.ci.url}>checks</ExternalLink>
            ) : null}
          </span>
        ) : (
          "—"
        )}
      </Property>
    </Properties>
  );
}

function RunSkeleton() {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={SPRINT_ICON}
        title="Run"
      />
      <div className="grid min-h-0 flex-1 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 p-5">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </div>
        <div className="flex flex-col gap-3 border-l p-5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </Page>
  );
}

export function RunView({ runId }: { runId: string }) {
  const { client, routes, slots: adminSlots } = useAdmin();
  const router = useRouter();
  const [run, setRun] = useState<CodingRun | null>(null);
  const [detail, setDetail] = useState<SprintDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadSprint = useCallback(
    async (sprintId: string) => {
      try {
        setDetail(await client.get<SprintDetail>(`sprints/${sprintId}`));
      } catch {
        setDetail(null);
      }
    },
    [client],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let lastStatus: CodingRun["status"] | null = null;
    setRun(null);
    const tick = async () => {
      try {
        const result = await client.get<{ run: CodingRun }>(
          `sprints/runs/${runId}`,
        );
        if (cancelled) return;
        setRun(result.run);
        if (lastStatus !== result.run.status) {
          void loadSprint(result.run.sprintId);
        }
        lastStatus = result.run.status;
        if (isLiveCodingRunStatus(result.run.status)) {
          timer = window.setTimeout(tick, LIVE_POLL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof AdminApiError && error.code === 404) {
          setMissing(true);
          return;
        }
        toast.error(errorMessage(error, "Failed to load run"));
      }
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [client, runId, loadSprint]);

  const live = run ? isLiveCodingRunStatus(run.status) : false;
  const now = useNow(live);

  if (missing) {
    return (
      <Page>
        <PageHeader
          leading={adminSlots?.sidebarTrigger}
          crumbs={[
            {
              label: "Sprints",
              onClick: () => router.push(routes.sprints.root),
            },
          ]}
          icon={SPRINT_ICON}
          title="Run"
        />
        <PageBody>
          <EmptyState icon={SPRINT_ICON} label="Not found" />
        </PageBody>
      </Page>
    );
  }
  if (!run) return <RunSkeleton />;

  const sprint = detail?.sprint ?? null;
  const slot: SprintSlot | undefined = detail?.slots.find(
    (candidate) => candidate.id === run.slotId,
  );
  const mergeable =
    sprint?.release?.state === "ready" && sprint.release.runId === run.id;
  const retryable =
    !live && (slot ? canRetrySlot(slot.status) : run.status !== "succeeded");

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(errorMessage(error, "Request failed"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () =>
    act(async () => {
      const result = await client.post<{ run: CodingRun }>(
        `sprints/runs/${run.id}/cancel`,
      );
      setRun(result.run);
    });

  const retry = () =>
    act(async () => {
      const result = await client.post<{ slot: SprintSlot }>(
        `sprints/${run.sprintId}/slots/${run.slotId}/retry`,
      );
      if (result.slot.lastRunId && result.slot.lastRunId !== run.id) {
        router.push(routes.sprints.run(result.slot.lastRunId));
      } else {
        await loadSprint(run.sprintId);
      }
    });

  const merge = () =>
    act(async () => {
      await client.post(`sprints/${run.sprintId}/merge`);
      await loadSprint(run.sprintId);
    });

  const chatStatus: ChatStatus =
    run.status === "running"
      ? "streaming"
      : run.status === "queued"
        ? "submitted"
        : "ready";

  return (
    <Page>
      <PageHeader
        leading={adminSlots?.sidebarTrigger}
        crumbs={[
          { label: "Sprints", onClick: () => router.push(routes.sprints.root) },
          {
            label: sprint?.title ?? "Sprint",
            onClick: () => router.push(routes.sprints.sprint(run.sprintId)),
          },
        ]}
        icon={SPRINT_ICON}
        title={slot?.title ?? SLOT_KIND_LABEL[run.kind]}
      >
        {live ? (
          <ConfirmButton
            trigger={
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || run.cancelRequested}
              >
                <Square /> {run.cancelRequested ? "Cancelling" : "Cancel"}
              </Button>
            }
            title="Cancel this run?"
            actionLabel="Cancel run"
            destructive
            onConfirm={cancel}
          />
        ) : null}
        {retryable ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void retry()}
          >
            <RotateCcw /> Retry
          </Button>
        ) : null}
        {mergeable ? (
          <ConfirmButton
            trigger={
              <Button size="sm" disabled={busy}>
                {busy ? <Spinner /> : <GitMerge />}
                Merge
              </Button>
            }
            title={`Merge #${sprint?.prNumber ?? ""}?`}
            description={
              <span className="font-mono">
                {shortSha(sprint?.release?.sha)}
              </span>
            }
            actionLabel="Merge"
            onConfirm={merge}
          />
        ) : null}
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,45%)_minmax(0,1fr)] lg:grid-cols-[26rem_minmax(0,1fr)] lg:grid-rows-1">
        <ScrollArea className="min-h-0 border-b lg:border-r lg:border-b-0">
          <div className="flex flex-col gap-6 px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-accent-strong">
              <StatusDot
                tone={RUN_STATUS_TONE[run.status]}
                label={run.status}
                className={cn(run.status === "running" && "animate-pulse")}
              />
              <span className="capitalize">{run.status}</span>
              {run.failure ? (
                <Badge variant="critical">
                  {FAILURE_LABEL[run.failure.code]}
                </Badge>
              ) : null}
            </div>

            <RunFacts run={run} now={now} />

            {run.failure ? (
              <Section title="Failure">
                <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                  {run.failure.message}
                </p>
                {run.ci?.failing && run.ci.failing.length > 0 ? (
                  <List>
                    {run.ci.failing.map((check) => (
                      <ListRow
                        key={check.name}
                        leading={<StatusDot tone="critical" />}
                        title={
                          check.url ? (
                            <a
                              href={check.url}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              {check.name}
                            </a>
                          ) : (
                            check.name
                          )
                        }
                      />
                    ))}
                  </List>
                ) : null}
              </Section>
            ) : null}

            {run.result ? (
              <Section title="Result">
                <ResultBody result={run.result} run={run} />
              </Section>
            ) : null}

            <FindingDetails result={run.result} />
          </div>
        </ScrollArea>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="border-b px-4 py-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-3xl border border-border bg-background px-4 pt-3.5 pb-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
              <div className="max-h-48 overflow-y-auto">
                {slot?.task.trim() ? (
                  <MarkdownRenderer content={slot.task} className="text-sm" />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {SLOT_KIND_LABEL[run.kind]}
                  </span>
                )}
                {run.config.instructions.trim() ? (
                  <p className="mt-2 whitespace-pre-wrap border-t pt-2 font-mono text-xs text-muted-foreground">
                    {run.config.instructions}
                  </p>
                ) : null}
              </div>
              <div className="-mx-1.5 flex flex-wrap items-center gap-1">
                <RunConfigSummary config={run.config} />
              </div>
            </div>
          </div>
          {run.status === "queued" && run.messages.length === 0 ? (
            <div className="flex-1 px-4 py-5">
              <Marker role="status" className="text-xs">
                <MarkerContent>
                  <Shimmer>Queued</Shimmer>
                </MarkerContent>
              </Marker>
            </div>
          ) : (
            <AgentMessageList
              messages={run.messages}
              status={chatStatus}
              handlers={NO_HANDLERS}
              contentClassName="max-w-3xl"
            />
          )}
        </div>
      </div>
    </Page>
  );
}
