"use client";

import type {
  AgentGoal,
  AgentMemory,
  AgentMemoryCandidate,
  AgentMemoryRun,
  AgentMemorySettings,
  AgentProcedure,
  AgentReflectionOverview,
  AgentRetrievalTrace,
  AgentUserModel,
  AgentUserModelRevision,
} from "@repo/schemas";
import {
  agentMemoryListResponseSchema,
  agentReflectionOverviewSchema,
  agentRetrievalTraceListResponseSchema,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  History,
  Play,
  RefreshCw,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function gateLabel(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off";
}

export function AgentMemorySkeleton() {
  const { slots } = useAdmin();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<BrainCircuit className="size-4 text-muted-foreground" />}
        title="Agent Memory"
      />
      <div className="flex flex-col gap-4 px-4 pt-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

export function AgentMemoryPage() {
  const { client, slots } = useAdmin();
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [candidates, setCandidates] = useState<AgentMemoryCandidate[]>([]);
  const [settings, setSettings] = useState<AgentMemorySettings | null>(null);
  const [traces, setTraces] = useState<AgentRetrievalTrace[]>([]);
  const [reflection, setReflection] = useState<AgentReflectionOverview | null>(
    null,
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningReflection, setRunningReflection] = useState(false);
  const [rollingBackRevision, setRollingBackRevision] = useState<number | null>(
    null,
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      else setRefreshing(true);
      try {
        const [overviewRaw, tracesRaw, reflectionRaw] = await Promise.all([
          client.get<unknown>("agent-memory?limit=100"),
          client.get<unknown>("agent-memory/retrieval-traces?limit=100"),
          client.get<unknown>("agent-memory/reflection"),
        ]);
        const overview = agentMemoryListResponseSchema.parse(overviewRaw);
        const traceList =
          agentRetrievalTraceListResponseSchema.parse(tracesRaw);
        const reflectionOverview =
          agentReflectionOverviewSchema.parse(reflectionRaw);
        setMemories(overview.memories);
        setCandidates(overview.candidates);
        setSettings(overview.settings);
        setTraces(traceList.traces);
        setReflection(reflectionOverview);
        setSelectedTraceId((current) =>
          current && traceList.traces.some((trace) => trace.traceId === current)
            ? current
            : (traceList.traces[0]?.traceId ?? null),
        );
      } catch {
        toast.error("Failed to load agent memory data");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const decideCandidate = async (
    candidate: AgentMemoryCandidate,
    action: "accept" | "dismiss",
  ) => {
    try {
      await client.post(`agent-memory/candidates/${candidate.id}`, {
        action,
        reason:
          action === "accept"
            ? "Accepted from agent memory review"
            : "Dismissed from agent memory review",
      });
      toast.success(
        action === "accept" ? "Memory accepted" : "Candidate dismissed",
      );
      await load(true);
    } catch {
      toast.error("Memory review action failed");
    }
  };

  const runReflection = async () => {
    setRunningReflection(true);
    try {
      await client.post("agent-memory/reflection", {});
      toast.success("Reflection run completed");
      await load(true);
    } catch {
      toast.error("Reflection run failed");
    } finally {
      setRunningReflection(false);
    }
  };

  const rollbackProjection = async (revision: number) => {
    setRollingBackRevision(revision);
    try {
      await client.post("agent-memory/user-model/rollback", {
        targetRevision: revision,
        reason: `Owner rollback to user-model revision ${revision}`,
      });
      toast.success(`Restored revision ${revision}`);
      await load(true);
    } catch {
      toast.error("User-model rollback failed");
    } finally {
      setRollingBackRevision(null);
    }
  };

  if (loading) return <AgentMemorySkeleton />;

  const selectedTrace = traces.find(
    (trace) => trace.traceId === selectedTraceId,
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<BrainCircuit className="size-4 text-muted-foreground" />}
        title="Agent Memory"
      >
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void load(true)}
          disabled={refreshing}
          title="Refresh memory data"
        >
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-8">
        {settings && <GateStrip settings={settings} />}

        <Tabs defaultValue="memories" className="flex min-h-0 flex-col">
          <TabsList
            variant="line"
            className="w-full justify-start overflow-x-auto"
          >
            <TabsTrigger value="memories">
              Memories <span className="tabular-nums">{memories.length}</span>
            </TabsTrigger>
            <TabsTrigger value="review">
              Review <span className="tabular-nums">{candidates.length}</span>
            </TabsTrigger>
            <TabsTrigger value="profile">
              Profile{" "}
              <span className="tabular-nums">
                {reflection?.userModel?.revision ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger value="goals">
              Goals{" "}
              <span className="tabular-nums">
                {reflection?.goals.length ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger value="procedures">
              Procedures{" "}
              <span className="tabular-nums">
                {reflection?.procedures.length ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger value="runs">
              Runs{" "}
              <span className="tabular-nums">
                {reflection?.runs.length ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger value="traces">
              Traces <span className="tabular-nums">{traces.length}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="memories" className="mt-3">
            <MemoryTable memories={memories} />
          </TabsContent>

          <TabsContent value="review" className="mt-3">
            <CandidateTable
              candidates={candidates}
              onDecide={decideCandidate}
            />
          </TabsContent>

          <TabsContent value="profile" className="mt-3">
            <ProfilePanel
              model={reflection?.userModel ?? null}
              revisions={reflection?.revisions ?? []}
              running={runningReflection}
              rollingBackRevision={rollingBackRevision}
              onRun={runReflection}
              onRollback={rollbackProjection}
            />
          </TabsContent>

          <TabsContent value="goals" className="mt-3">
            <GoalTable goals={reflection?.goals ?? []} />
          </TabsContent>

          <TabsContent value="procedures" className="mt-3">
            <ProcedureTable procedures={reflection?.procedures ?? []} />
          </TabsContent>

          <TabsContent value="runs" className="mt-3">
            <RunTable runs={reflection?.runs ?? []} />
          </TabsContent>

          <TabsContent value="traces" className="mt-3 min-h-0">
            <TraceExplorer
              traces={traces}
              selected={selectedTrace}
              onSelect={setSelectedTraceId}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function GateStrip({ settings }: { settings: AgentMemorySettings }) {
  const gates = [
    ["A Evidence", settings.releaseGates.evidenceLedger],
    ["B Formation", settings.releaseGates.formation],
    ["C Shadow", settings.releaseGates.shadowRetrieval],
    ["D Chat", settings.releaseGates.chatMemory],
    ["E Reflection", settings.releaseGates.reflection],
    ["F Proactivity", settings.releaseGates.proactivity],
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b pb-3">
      {gates.map(([label, enabled]) => (
        <div key={label} className="flex items-center gap-1.5 text-xs">
          <span
            className={enabled ? "text-emerald-600" : "text-muted-foreground"}
          >
            {enabled ? (
              <Check className="size-3.5" />
            ) : (
              <CircleSlash className="size-3.5" />
            )}
          </span>
          <span>{label}</span>
          <span className="text-muted-foreground">{gateLabel(enabled)}</span>
        </div>
      ))}
    </div>
  );
}

function MemoryTable({ memories }: { memories: AgentMemory[] }) {
  if (memories.length === 0) return <EmptyRow text="No active memories" />;
  return (
    <div className="overflow-x-auto border-y">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Statement</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Trust</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
            <TableHead className="text-right">Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {memories.map((memory) => (
            <TableRow key={memory.id}>
              <TableCell className="max-w-xl whitespace-normal font-medium">
                {memory.statement}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{memory.memoryType}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {memory.trust}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {percent(memory.confidence)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {memory.evidenceIds.length}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CandidateTable({
  candidates,
  onDecide,
}: {
  candidates: AgentMemoryCandidate[];
  onDecide: (
    candidate: AgentMemoryCandidate,
    action: "accept" | "dismiss",
  ) => void;
}) {
  if (candidates.length === 0)
    return <EmptyRow text="No candidates awaiting review" />;
  return (
    <div className="overflow-x-auto border-y">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Proposal</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => (
            <TableRow key={candidate.id}>
              <TableCell className="max-w-lg whitespace-normal font-medium">
                {candidate.statement}
              </TableCell>
              <TableCell className="max-w-sm whitespace-normal text-muted-foreground">
                {candidate.reason}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {candidate.reviewFlags.map((flag) => (
                    <Badge key={flag} variant="secondary">
                      {flag}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Accept candidate"
                    onClick={() => onDecide(candidate, "accept")}
                  >
                    <Check />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Dismiss candidate"
                    onClick={() => onDecide(candidate, "dismiss")}
                  >
                    <X />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function revisionDiff(
  revision: AgentUserModelRevision,
  previous?: AgentUserModelRevision,
) {
  const keys = (value?: AgentUserModelRevision) =>
    new Set(
      Object.values(value?.sections ?? {})
        .flat()
        .map((chunk) => chunk.key),
    );
  const currentKeys = keys(revision);
  const previousKeys = keys(previous);
  return {
    added: [...currentKeys].filter((key) => !previousKeys.has(key)).length,
    removed: [...previousKeys].filter((key) => !currentKeys.has(key)).length,
  };
}

function ProfilePanel({
  model,
  revisions,
  running,
  rollingBackRevision,
  onRun,
  onRollback,
}: {
  model: AgentUserModel | null;
  revisions: AgentUserModelRevision[];
  running: boolean;
  rollingBackRevision: number | null;
  onRun: () => void;
  onRollback: (revision: number) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <p className="text-sm font-medium">
            {model
              ? `Projection revision ${model.revision}`
              : "No projection yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {model
              ? `Generated ${formatDate(model.generatedAt)}`
              : "Run reflection to build the evidence-backed profile."}
          </p>
        </div>
        <Button size="sm" onClick={onRun} disabled={running}>
          {running ? <RefreshCw className="animate-spin" /> : <Play />}
          Run reflection
        </Button>
      </div>

      {model ? (
        <div className="divide-y border-y">
          {Object.entries(model.sections)
            .filter(([, chunks]) => chunks.length > 0)
            .map(([section, chunks]) => (
              <section key={section} className="py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">{section}</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {chunks.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {chunks.map((chunk) => (
                    <div
                      key={chunk.key}
                      className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <p className="min-w-0 break-words">{chunk.statement}</p>
                      <span className="text-xs text-muted-foreground">
                        {chunk.explicitness} / {percent(chunk.confidence)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
        </div>
      ) : (
        <EmptyRow text="No derived profile" />
      )}

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <History className="size-4 text-muted-foreground" />
          Revision history
        </div>
        {revisions.length === 0 ? (
          <EmptyRow text="No profile revisions" />
        ) : (
          <div className="divide-y border-y">
            {revisions.map((revision, index) => {
              const diff = revisionDiff(revision, revisions[index + 1]);
              const isCurrent = revision.revision === model?.revision;
              return (
                <div
                  key={revision.id}
                  className="flex min-w-0 items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">
                        Revision {revision.revision}
                      </span>
                      <Badge variant="outline">{revision.createdBy}</Badge>
                      {isCurrent && <Badge variant="secondary">current</Badge>}
                    </div>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={revision.reason}
                    >
                      {formatDate(revision.createdAt)} / +{diff.added} / -
                      {diff.removed} / {revision.reason}
                    </p>
                  </div>
                  {!isCurrent && (
                    <Button
                      size="icon"
                      variant="ghost"
                      title={`Restore revision ${revision.revision}`}
                      onClick={() => onRollback(revision.revision)}
                      disabled={rollingBackRevision !== null}
                    >
                      <Undo2
                        className={
                          rollingBackRevision === revision.revision
                            ? "animate-pulse"
                            : undefined
                        }
                      />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function GoalTable({ goals }: { goals: AgentGoal[] }) {
  if (goals.length === 0) return <EmptyRow text="No tracked goals" />;
  return (
    <div className="overflow-x-auto border-y">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Goal</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Target</TableHead>
            <TableHead className="text-right">Revision</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {goals.map((goal) => (
            <TableRow key={goal.id}>
              <TableCell className="max-w-xl whitespace-normal">
                <p className="font-medium">{goal.title}</p>
                {goal.description && (
                  <p className="text-xs text-muted-foreground">
                    {goal.description}
                  </p>
                )}
              </TableCell>
              <TableCell>{goal.kind}</TableCell>
              <TableCell>
                <Badge variant="outline">{goal.status}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {goal.targetUntil ? formatDate(goal.targetUntil) : "-"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {goal.revision}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ProcedureTable({ procedures }: { procedures: AgentProcedure[] }) {
  if (procedures.length === 0) return <EmptyRow text="No learned procedures" />;
  return (
    <div className="overflow-x-auto border-y">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Scope</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Behavior</TableHead>
            <TableHead>Lifecycle</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {procedures.map((procedure) => (
            <TableRow key={procedure.id}>
              <TableCell className="max-w-48 whitespace-normal font-medium">
                {procedure.scope}
              </TableCell>
              <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                {procedure.trigger}
              </TableCell>
              <TableCell className="max-w-lg whitespace-normal">
                {procedure.behavior}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{procedure.lifecycle}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {percent(procedure.confidence)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RunTable({ runs }: { runs: AgentMemoryRun[] }) {
  if (runs.length === 0) return <EmptyRow text="No reflection runs" />;
  return (
    <div className="overflow-x-auto border-y">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Inputs</TableHead>
            <TableHead className="text-right">Outputs</TableHead>
            <TableHead>Version</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>{formatDate(run.startedAt)}</TableCell>
              <TableCell>
                <Badge variant="outline">{run.status}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {run.inputIds.length}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {run.outputIds.length}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {run.promptVersion}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TraceExplorer({
  traces,
  selected,
  onSelect,
}: {
  traces: AgentRetrievalTrace[];
  selected?: AgentRetrievalTrace;
  onSelect: (traceId: string) => void;
}) {
  if (traces.length === 0)
    return <EmptyRow text="No shadow retrieval traces" />;
  return (
    <div className="grid min-h-[30rem] border-y lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.6fr)]">
      <div className="border-b lg:border-r lg:border-b-0">
        {traces.map((trace) => (
          <button
            type="button"
            key={trace.traceId}
            onClick={() => onSelect(trace.traceId)}
            className={`flex w-full flex-col gap-1 border-b px-3 py-3 text-left hover:bg-muted/50 ${selected?.traceId === trace.traceId ? "bg-muted" : ""}`}
          >
            <span className="line-clamp-2 text-sm font-medium">
              {trace.query}
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {formatDate(trace.createdAt)}
              <span>{trace.candidates.length} candidates</span>
              {trace.abstained && <Badge variant="outline">abstained</Badge>}
            </span>
          </button>
        ))}
      </div>
      <div className="min-w-0 p-4">
        {selected && <TraceDetail trace={selected} />}
      </div>
    </div>
  );
}

function TraceDetail({ trace }: { trace: AgentRetrievalTrace }) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-5 overflow-hidden">
      <div>
        <div className="mb-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Search className="size-3.5 shrink-0" />
          <span className="shrink-0">{trace.purpose}</span>
          <span className="min-w-0 truncate font-mono" title={trace.traceId}>
            {trace.traceId}
          </span>
        </div>
        <p className="text-sm font-medium">{trace.query}</p>
      </div>
      <div className="flex flex-wrap gap-6 text-xs">
        <Metric label="Candidates" value={String(trace.candidates.length)} />
        <Metric
          label="Selected"
          value={String(trace.selectedRevisionIds.length)}
        />
        <Metric
          label="Tokens"
          value={`${trace.estimatedTokens} / ${trace.tokenBudget}`}
        />
        <Metric label="Injected" value={trace.injected ? "yes" : "no"} />
      </div>
      <TraceCandidates
        candidates={trace.candidates}
        selectedIds={trace.selectedRevisionIds}
      />
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          Exclusions
        </h3>
        {trace.exclusions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exclusions</p>
        ) : (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-l-2 pl-3 text-xs">
            {JSON.stringify(trace.exclusions, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function TraceCandidates({
  candidates,
  selectedIds,
}: {
  candidates: Record<string, unknown>[];
  selectedIds: string[];
}) {
  if (candidates.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No candidates returned</p>
    );
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        Ranked candidates
      </h3>
      {candidates.map((candidate, index) => {
        const revisionId = String(candidate.revisionId ?? "");
        return (
          <TraceCandidate
            key={`${revisionId}-${index}`}
            candidate={candidate}
            selected={selectedIds.includes(revisionId)}
          />
        );
      })}
    </div>
  );
}

function TraceCandidate({
  candidate,
  selected,
}: {
  candidate: Record<string, unknown>;
  selected: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const score = typeof candidate.score === "number" ? candidate.score : 0;
  const statement = String(candidate.statement ?? "");
  const components = JSON.stringify(candidate.components ?? {});
  const evidence = Array.isArray(candidate.evidenceIds)
    ? candidate.evidenceIds.join(", ")
    : "none";
  const toggleLabel = expanded ? "Collapse candidate" : "Expand candidate";

  return (
    <div className="min-w-0 max-w-full overflow-hidden border-l-2 px-3 py-1.5">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2">
        <p
          className={`min-w-0 break-words text-sm ${expanded ? "" : "line-clamp-2"}`}
        >
          {statement}
        </p>
        <Badge variant={selected ? "default" : "outline"}>
          {score.toFixed(3)}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
      </div>
      {expanded ? (
        <pre className="mt-1 max-w-full whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(candidate.components ?? {}, null, 2)}
        </pre>
      ) : (
        <p className="mt-1 max-w-full truncate font-mono text-[11px] text-muted-foreground">
          {components}
        </p>
      )}
      <p
        className={`mt-1 max-w-full text-[11px] text-muted-foreground ${expanded ? "break-all" : "truncate"}`}
      >
        Evidence: {evidence}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex min-h-52 items-center justify-center border-y text-sm text-muted-foreground">
      {text}
    </div>
  );
}
