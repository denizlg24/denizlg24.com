"use client";

import type {
  AgentGoal,
  AgentInsight,
  AgentInsightListResponse,
  AgentMemory,
  AgentMemoryCandidate,
  AgentMemoryContradictionListResponse,
  AgentMemoryGraphResponse,
  AgentMemoryListResponse,
  AgentMemoryRun,
  AgentMemorySettings,
  AgentPersonDraft,
  AgentProcedure,
  AgentReflectionOverview,
  AgentResourceSuggestion,
  AgentResourceSuggestionListResponse,
  AgentRetrievalTrace,
  AgentUserModel,
  AgentUserModelRevision,
} from "@repo/schemas";
import {
  agentInsightListResponseSchema,
  agentMemoryContradictionListResponseSchema,
  agentMemoryListResponseSchema,
  agentMemorySchema,
  agentReflectionOverviewSchema,
  agentResourceSuggestionListResponseSchema,
  agentRetrievalTraceListResponseSchema,
  bulkAgentCandidateDecisionResponseSchema,
  generateAgentResourceSuggestionsResponseSchema,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { PageHeader } from "@repo/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  History,
  List,
  Loader2,
  Orbit,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  ThumbsUp,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { fetchAgentMemoryGraph } from "./graph-prefetch";
import { MemoryGraph } from "./memory-graph";

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<BrainCircuit className="size-4 text-muted-foreground" />}
        title="Agent Memory"
      >
        <Button size="icon" variant="ghost" title="Refresh memory data">
          <RefreshCw />
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Tabs value={"graph"}>
          <TabsList className="h-7!">
            <TabsTrigger
              value="graph"
              className="h-5.5 px-2 text-xs"
              title="Graph view"
            >
              <Orbit className="size-3.5" />
            </TabsTrigger>
            <TabsTrigger
              value="list"
              className="h-5.5 px-2 text-xs"
              title="List view"
            >
              <List className="size-3.5" />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <RefreshCw className="size-4 animate-spin" />
          Building memory graph…
        </span>
      </div>
    </div>
  );
}

interface OverviewMeta {
  totalMemories: number;
  totalCandidates: number;
  pendingCandidates: number;
  memoryPage: number;
  candidatePage: number;
  pageSize: number;
}

interface OverviewQuery {
  memoryPage: number;
  candidatePage: number;
  memoryStatus: string;
  memoryType: string;
  memorySort: string;
  candidateSort: string;
}

const DEFAULT_OVERVIEW_QUERY: OverviewQuery = {
  memoryPage: 1,
  candidatePage: 1,
  memoryStatus: "active",
  memoryType: "all",
  memorySort: "importance",
  candidateSort: "confidence",
};

export function AgentMemoryPage() {
  const { client, slots } = useAdmin();
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [candidates, setCandidates] = useState<AgentMemoryCandidate[]>([]);
  const [meta, setMeta] = useState<OverviewMeta | null>(null);
  const [insights, setInsights] = useState<AgentInsight[]>([]);
  const [insightStats, setInsightStats] = useState<
    AgentInsightListResponse["stats"] | null
  >(null);
  const [suggestions, setSuggestions] = useState<AgentResourceSuggestion[]>([]);
  const [suggestionStats, setSuggestionStats] = useState<
    AgentResourceSuggestionListResponse["stats"] | null
  >(null);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [settings, setSettings] = useState<AgentMemorySettings | null>(null);
  const [traces, setTraces] = useState<AgentRetrievalTrace[]>([]);
  const [reflection, setReflection] = useState<AgentReflectionOverview | null>(
    null,
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<AgentMemory | null>(
    null,
  );
  const [view, setView] = useState<"graph" | "list">("graph");
  const [section, setSection] = useState("inbox");
  const [filters, setFilters] = useState<OverviewQuery>(DEFAULT_OVERVIEW_QUERY);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [bulkDeciding, setBulkDeciding] = useState<"accept" | "dismiss" | null>(
    null,
  );
  const [graph, setGraph] = useState<AgentMemoryGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const graphRequestedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningReflection, setRunningReflection] = useState(false);
  const [rollingBackRevision, setRollingBackRevision] = useState<number | null>(
    null,
  );
  const queryRef = useRef<OverviewQuery>({ ...DEFAULT_OVERVIEW_QUERY });

  const applyOverview = useCallback((overview: AgentMemoryListResponse) => {
    setMemories(overview.memories);
    setCandidates(overview.candidates);
    setSettings(overview.settings);
    setMeta({
      totalMemories: overview.totalMemories,
      totalCandidates: overview.totalCandidates,
      pendingCandidates: overview.pendingCandidates,
      memoryPage: overview.memoryPage,
      candidatePage: overview.candidatePage,
      pageSize: overview.pageSize,
    });
    setSelectedCandidateIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(overview.candidates.map((candidate) => candidate.id));
      return new Set([...prev].filter((id) => ids.has(id)));
    });
  }, []);

  const fetchOverview = useCallback(async () => {
    const query = queryRef.current;
    const params = new URLSearchParams({
      memoryPage: String(query.memoryPage),
      candidatePage: String(query.candidatePage),
      status: query.memoryStatus,
      memorySort: query.memorySort,
      candidateSort: query.candidateSort,
    });
    if (query.memoryType !== "all") params.set("memoryType", query.memoryType);
    const overviewRaw = await client.get<unknown>(`agent-memory?${params}`);
    applyOverview(agentMemoryListResponseSchema.parse(overviewRaw));
  }, [client, applyOverview]);

  const updateQuery = async (patch: Partial<OverviewQuery>) => {
    if (
      "memoryStatus" in patch ||
      "memoryType" in patch ||
      "memorySort" in patch
    ) {
      patch.memoryPage = 1;
    }
    if ("candidateSort" in patch) patch.candidatePage = 1;
    Object.assign(queryRef.current, patch);
    setFilters({ ...queryRef.current });
    try {
      await fetchOverview();
    } catch {
      toast.error("Failed to load list");
    }
  };

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      else setRefreshing(true);
      try {
        const [, tracesRaw, reflectionRaw, insightsRaw, suggestionList] =
          await Promise.all([
            fetchOverview(),
            client.get<unknown>("agent-memory/retrieval-traces?limit=100"),
            client.get<unknown>("agent-memory/reflection"),
            client.get<unknown>("agent-memory/insights"),
            // Isolated: a failure or parse error here must not blank traces,
            // reflection, and insights — keep the previous inbox instead.
            client
              .get<unknown>("agent-memory/resource-suggestions?status=pending")
              .then((raw) =>
                agentResourceSuggestionListResponseSchema.parse(raw),
              )
              .catch(() => null),
          ]);
        const traceList =
          agentRetrievalTraceListResponseSchema.parse(tracesRaw);
        const reflectionOverview =
          agentReflectionOverviewSchema.parse(reflectionRaw);
        const insightList = agentInsightListResponseSchema.parse(insightsRaw);
        setInsights(insightList.insights);
        setInsightStats(insightList.stats);
        if (suggestionList) {
          setSuggestions(suggestionList.suggestions);
          setSuggestionStats(suggestionList.stats);
        }
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
    [client, fetchOverview],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const loadGraph = useCallback(
    async (options: { force?: boolean; silent?: boolean } = {}) => {
      graphRequestedRef.current = true;
      if (!options.silent) setGraphLoading(true);
      try {
        // Served from the app-load prefetch cache when it is still warm.
        const next = await fetchAgentMemoryGraph(client, options);
        // Keep the previous object when nothing changed so the force layout
        // is not reheated by a no-op refresh (generatedAt always differs).
        setGraph((prev) =>
          prev &&
          JSON.stringify({ nodes: prev.nodes, links: prev.links }) ===
            JSON.stringify({ nodes: next.nodes, links: next.links })
            ? prev
            : next,
        );
      } catch {
        if (!options.silent) toast.error("Failed to load memory graph");
      } finally {
        if (!options.silent) setGraphLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    if (view === "graph" && !graphRequestedRef.current) void loadGraph();
  }, [view, loadGraph]);

  // Live refresh: keep the graph in sync with memory churn without ever
  // flashing the loading state — unchanged data is dropped in loadGraph.
  useEffect(() => {
    if (view !== "graph") return;
    const interval = setInterval(() => {
      if (document.hidden || !graphRequestedRef.current) return;
      void loadGraph({ force: true, silent: true });
    }, 45_000);
    return () => clearInterval(interval);
  }, [view, loadGraph]);

  const openMemory = useCallback(
    async (memoryId: string) => {
      const local = memories.find((memory) => memory.id === memoryId);
      if (local) {
        setSelectedMemory(local);
        return;
      }
      try {
        const raw = await client.get<unknown>(
          `agent-memory/memories/${memoryId}`,
        );
        setSelectedMemory(
          agentMemorySchema.parse((raw as { memory?: unknown })?.memory),
        );
      } catch {
        toast.error("Failed to load memory");
      }
    },
    [client, memories],
  );

  // Optimistically drop decided candidates from the inbox; the caller keeps a
  // snapshot to restore on failure and a background refresh reconciles stats.
  const removeCandidatesLocally = (candidateIds: string[]) => {
    const ids = new Set(candidateIds);
    setCandidates((prev) => prev.filter((item) => !ids.has(item.id)));
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setMeta((prev) =>
      prev
        ? {
            ...prev,
            totalCandidates: Math.max(0, prev.totalCandidates - ids.size),
            pendingCandidates: Math.max(0, prev.pendingCandidates - ids.size),
          }
        : prev,
    );
  };

  const decideCandidate = async (
    candidate: AgentMemoryCandidate,
    action: "accept" | "dismiss",
  ) => {
    const previousCandidates = candidates;
    const previousSelection = selectedCandidateIds;
    const previousMeta = meta;
    removeCandidatesLocally([candidate.id]);
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
      void fetchOverview();
    } catch {
      setCandidates(previousCandidates);
      setSelectedCandidateIds(previousSelection);
      setMeta(previousMeta);
      toast.error("Memory review action failed");
    }
  };

  const toggleCandidate = (candidateId: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const togglePageSelection = (selectAll: boolean) => {
    setSelectedCandidateIds(
      selectAll
        ? new Set(candidates.map((candidate) => candidate.id))
        : new Set(),
    );
  };

  const decideSelected = async (action: "accept" | "dismiss") => {
    const candidateIds = [...selectedCandidateIds];
    if (candidateIds.length === 0) return;
    const previousCandidates = candidates;
    const previousSelection = selectedCandidateIds;
    const previousMeta = meta;
    setBulkDeciding(action);
    removeCandidatesLocally(candidateIds);
    try {
      const raw = await client.post<unknown>("agent-memory/candidates/bulk", {
        action,
        candidateIds,
        reason:
          action === "accept"
            ? "Bulk accepted from agent memory review"
            : "Bulk dismissed from agent memory review",
      });
      const result = bulkAgentCandidateDecisionResponseSchema.parse(raw);
      const verb = action === "accept" ? "Accepted" : "Dismissed";
      if (result.failed.length > 0) {
        toast.warning(
          `${verb} ${result.succeeded} candidates; ${result.failed.length} failed`,
        );
      } else {
        toast.success(`${verb} ${result.succeeded} candidates`);
      }
      // Background reconcile: restores any failed candidates and fixes counts.
      void fetchOverview();
    } catch {
      setCandidates(previousCandidates);
      setSelectedCandidateIds(previousSelection);
      setMeta(previousMeta);
      toast.error("Bulk review action failed");
    } finally {
      setBulkDeciding(null);
    }
  };

  const actOnInsight = async (
    insight: AgentInsight,
    action: "dismiss" | "snooze" | "useful",
  ) => {
    let snoozedUntil: string | undefined;
    if (action === "snooze") {
      const snoozeMs = Math.min(
        Date.now() + 24 * 60 * 60 * 1_000,
        new Date(insight.expiresAt).getTime() - 60_000,
      );
      if (snoozeMs <= Date.now()) {
        toast.error("Insight expires too soon to snooze");
        return;
      }
      snoozedUntil = new Date(snoozeMs).toISOString();
    }
    // Optimistic: dismissed insights leave the list immediately, snoozed ones
    // flip status in place; a background refresh reconciles stats.
    const previousInsights = insights;
    if (action === "dismiss") {
      setInsights((prev) => prev.filter((item) => item.id !== insight.id));
    } else if (action === "snooze") {
      setInsights((prev) =>
        prev.map((item) =>
          item.id === insight.id
            ? { ...item, status: "snoozed", snoozedUntil }
            : item,
        ),
      );
    }
    try {
      await client.patch(`agent-memory/insights/${insight.id}`, {
        action,
        snoozedUntil,
      });
      toast.success(
        action === "useful"
          ? "Marked as useful"
          : action === "snooze"
            ? "Insight snoozed"
            : "Insight dismissed",
      );
      void load(true);
    } catch {
      setInsights(previousInsights);
      toast.error("Insight action failed");
    }
  };

  const decideSuggestion = async (
    suggestion: AgentResourceSuggestion,
    action: "accept" | "dismiss",
    draft?: AgentPersonDraft,
  ) => {
    // Optimistic: the decided suggestion leaves the list immediately; a
    // background refresh reconciles stats and restores it on failure.
    const previousSuggestions = suggestions;
    const previousStats = suggestionStats;
    setSuggestions((prev) => prev.filter((item) => item.id !== suggestion.id));
    setSuggestionStats((prev) =>
      prev ? { ...prev, pending: Math.max(0, prev.pending - 1) } : prev,
    );
    try {
      await client.post(`agent-memory/resource-suggestions/${suggestion.id}`, {
        action,
        reason:
          action === "accept"
            ? "Accepted from resource suggestion review"
            : "Dismissed from resource suggestion review",
        ...(action === "accept" && draft ? { draft } : {}),
      });
      toast.success(
        action === "accept"
          ? `Created ${(draft ?? suggestion.draft).name}`
          : "Suggestion dismissed",
      );
      void load(true);
    } catch {
      setSuggestions(previousSuggestions);
      setSuggestionStats(previousStats);
      toast.error("Suggestion decision failed");
    }
  };

  const generateSuggestions = async (model?: string) => {
    setGeneratingSuggestions(true);
    try {
      const raw = await client.post<unknown>(
        "agent-memory/resource-suggestions",
        model ? { model } : {},
      );
      const result = generateAgentResourceSuggestionsResponseSchema.parse(raw);
      if (result.created === 0) {
        toast.info(
          `No new suggestions — ${result.skipped} entities skipped (already suggested, already in the directory, or too little to go on)`,
        );
      } else {
        toast.success(
          `${result.created} suggestion${result.created === 1 ? "" : "s"} ready for review`,
        );
      }
      void load(true);
    } catch {
      toast.error("Suggestion generation failed");
    } finally {
      setGeneratingSuggestions(false);
    }
  };

  const updateSettings = async (
    patch: Record<string, unknown>,
    reason: string,
  ) => {
    try {
      const raw = await client.patch<unknown>("agent-memory/settings", {
        settings: patch,
        reason,
      });
      const parsed = (raw as { settings?: unknown })?.settings;
      if (parsed) {
        setSettings(parsed as AgentMemorySettings);
      }
      toast.success("Settings updated");
    } catch {
      toast.error("Settings update failed");
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

  const sectionOptions: [value: string, label: string, count?: number][] = [
    ["inbox", "Inbox", insightStats?.pending],
    ["memories", "Memories", meta?.totalMemories],
    ["review", "Review", meta?.totalCandidates],
    ["suggestions", "Suggestions", suggestionStats?.pending],
    ["profile", "Profile", undefined],
    ["goals", "Goals", reflection?.goals.length],
    ["procedures", "Procedures", reflection?.procedures.length],
    ["runs", "Runs", reflection?.runs.length],
    ["traces", "Traces", traces.length],
    ["settings", "Settings", undefined],
  ];

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
          onClick={() => {
            void load(true);
            if (graphRequestedRef.current) void loadGraph({ force: true });
          }}
          disabled={refreshing}
          title="Refresh memory data"
        >
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Tabs
          value={view}
          onValueChange={(value) => setView(value as "graph" | "list")}
        >
          <TabsList className="h-7!">
            <TabsTrigger
              value="graph"
              className="h-5.5 px-2 text-xs"
              title="Graph view"
            >
              <Orbit className="size-3.5" />
            </TabsTrigger>
            <TabsTrigger
              value="list"
              className="h-5.5 px-2 text-xs"
              title="List view"
            >
              <List className="size-3.5" />
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "list" ? (
          <>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger className="h-7 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sectionOptions.map(([value, label, count]) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {label}
                    {count !== undefined ? ` · ${count}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {section === "memories" && (
              <>
                <Select
                  value={filters.memoryStatus}
                  onValueChange={(value) =>
                    void updateQuery({ memoryStatus: value })
                  }
                >
                  <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active" className="text-xs">
                      Active
                    </SelectItem>
                    <SelectItem value="superseded" className="text-xs">
                      Superseded
                    </SelectItem>
                    <SelectItem value="archived" className="text-xs">
                      Archived
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={filters.memoryType}
                  onValueChange={(value) =>
                    void updateQuery({ memoryType: value })
                  }
                >
                  <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      All types
                    </SelectItem>
                    <SelectItem value="core" className="text-xs">
                      Core
                    </SelectItem>
                    <SelectItem value="semantic" className="text-xs">
                      Semantic
                    </SelectItem>
                    <SelectItem value="episodic" className="text-xs">
                      Episodic
                    </SelectItem>
                    <SelectItem value="reflection" className="text-xs">
                      Reflection
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={filters.memorySort}
                  onValueChange={(value) =>
                    void updateQuery({ memorySort: value })
                  }
                >
                  <SelectTrigger className="h-7 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="importance" className="text-xs">
                      By importance
                    </SelectItem>
                    <SelectItem value="confidence" className="text-xs">
                      By confidence
                    </SelectItem>
                    <SelectItem value="recent" className="text-xs">
                      Most recent
                    </SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}

            {section === "review" && (
              <Select
                value={filters.candidateSort}
                onValueChange={(value) =>
                  void updateQuery({ candidateSort: value })
                }
              >
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confidence" className="text-xs">
                    By confidence
                  </SelectItem>
                  <SelectItem value="recent" className="text-xs">
                    Most recent
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          </>
        ) : (
          graph && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {graph.nodes.length} nodes · {graph.links.length} links ·{" "}
              {graph.embeddedCount} embedded
            </span>
          )
        )}

        <div className="ml-auto">
          {settings && <GateDots settings={settings} />}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "graph" ? (
          graph ? (
            <MemoryGraph
              nodes={graph.nodes}
              links={graph.links}
              onSelectMemory={openMemory}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {graphLoading ? (
                <span className="flex items-center gap-2">
                  <RefreshCw className="size-4 animate-spin" />
                  Building memory graph…
                </span>
              ) : (
                <Button variant="ghost" onClick={() => void loadGraph()}>
                  Load memory graph
                </Button>
              )}
            </div>
          )
        ) : (
          <div className="h-full overflow-y-auto px-4 pt-3 pb-8">
            {section === "inbox" && (
              <>
                <InsightInbox
                  insights={insights}
                  proactivityEnabled={
                    settings?.releaseGates.proactivity ?? false
                  }
                  onAct={actOnInsight}
                />
                <ContradictionPanel onSelectMemory={setSelectedMemory} />
              </>
            )}

            {section === "memories" && (
              <>
                <MemoryTable memories={memories} onSelect={setSelectedMemory} />
                {meta && (
                  <PageFooter
                    page={meta.memoryPage}
                    pageSize={meta.pageSize}
                    total={meta.totalMemories}
                    label="memories"
                    onChange={(page) => void updateQuery({ memoryPage: page })}
                  />
                )}
              </>
            )}

            {section === "review" && (
              <>
                {selectedCandidateIds.size > 0 && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {selectedCandidateIds.size} selected
                    </span>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={bulkDeciding !== null}
                      onClick={() => void decideSelected("accept")}
                    >
                      {bulkDeciding === "accept" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Accept selected
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={bulkDeciding !== null}
                      onClick={() => void decideSelected("dismiss")}
                    >
                      {bulkDeciding === "dismiss" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <X className="size-3.5" />
                      )}
                      Dismiss selected
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={bulkDeciding !== null}
                      onClick={() => setSelectedCandidateIds(new Set())}
                    >
                      Clear
                    </Button>
                  </div>
                )}
                <CandidateTable
                  candidates={candidates}
                  selected={selectedCandidateIds}
                  disabled={bulkDeciding !== null}
                  onToggle={toggleCandidate}
                  onTogglePage={togglePageSelection}
                  onDecide={decideCandidate}
                />
                {meta && (
                  <PageFooter
                    page={meta.candidatePage}
                    pageSize={meta.pageSize}
                    total={meta.totalCandidates}
                    label="candidates"
                    onChange={(page) =>
                      void updateQuery({ candidatePage: page })
                    }
                  />
                )}
              </>
            )}

            {section === "suggestions" && (
              <ResourceSuggestionInbox
                suggestions={suggestions}
                enabled={settings?.resourceSuggestions.enabled ?? false}
                generating={generatingSuggestions}
                onGenerate={generateSuggestions}
                onDecide={decideSuggestion}
              />
            )}

            {section === "profile" && (
              <ProfilePanel
                model={reflection?.userModel ?? null}
                revisions={reflection?.revisions ?? []}
                running={runningReflection}
                rollingBackRevision={rollingBackRevision}
                onRun={runReflection}
                onRollback={rollbackProjection}
              />
            )}

            {section === "goals" && (
              <GoalTable goals={reflection?.goals ?? []} />
            )}

            {section === "procedures" && (
              <ProcedureTable procedures={reflection?.procedures ?? []} />
            )}

            {section === "runs" && <RunTable runs={reflection?.runs ?? []} />}

            {section === "traces" && (
              <TraceExplorer
                traces={traces}
                selected={selectedTrace}
                onSelect={setSelectedTraceId}
              />
            )}

            {section === "settings" && settings && (
              <SettingsPanel settings={settings} onUpdate={updateSettings} />
            )}
          </div>
        )}
      </div>

      <MemoryDetailSheet
        memory={selectedMemory}
        onClose={() => setSelectedMemory(null)}
      />
    </div>
  );
}

function PageFooter({
  page,
  pageSize,
  total,
  label,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs tabular-nums text-muted-foreground">
        {total} {label} · page {page} of {totalPages}
      </span>
      <div className="flex gap-1">
        <Button
          size="icon"
          variant="ghost"
          title="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Next page"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function MemoryDetailSheet({
  memory,
  onClose,
}: {
  memory: AgentMemory | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={memory !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {memory && (
          <>
            <SheetHeader>
              <SheetTitle>Memory</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {memory.id} · revision {memory.revision}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-8">
              <p className="whitespace-pre-line text-sm">{memory.statement}</p>

              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{memory.memoryType}</Badge>
                <Badge variant="outline">{memory.status}</Badge>
                <Badge variant="secondary">{memory.explicitness}</Badge>
                <Badge variant="secondary">{memory.trust}</Badge>
                <Badge variant="secondary">{memory.sensitivity}</Badge>
                {memory.pinned && <Badge>pinned</Badge>}
              </div>

              <div className="flex flex-wrap gap-6 text-xs">
                <Metric label="Confidence" value={percent(memory.confidence)} />
                <Metric label="Importance" value={percent(memory.importance)} />
                <Metric
                  label="Evidence"
                  value={String(memory.evidenceIds.length)}
                />
                <Metric
                  label="Contradictions"
                  value={String(memory.contradictionIds.length)}
                />
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  Valid{" "}
                  {memory.temporal.validFrom
                    ? `from ${formatDate(memory.temporal.validFrom)}`
                    : "from unknown"}
                  {memory.temporal.validUntil
                    ? ` until ${formatDate(memory.temporal.validUntil)}`
                    : ""}{" "}
                  · precision {memory.temporal.precision}
                </p>
                {memory.temporal.condition && (
                  <p>Condition: {memory.temporal.condition}</p>
                )}
                <p>
                  Created {formatDate(memory.createdAt)} · updated{" "}
                  {formatDate(memory.updatedAt)}
                </p>
                {memory.supersedesMemoryId && (
                  <p className="font-mono">
                    Supersedes {memory.supersedesMemoryId}
                  </p>
                )}
              </div>

              {memory.entityRefs.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                    Linked entities
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {memory.entityRefs.map((ref) => (
                      <Badge
                        key={`${ref.entityType}:${ref.entityId}`}
                        variant="outline"
                      >
                        {ref.entityType}: {ref.label ?? ref.entityId}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {memory.evidenceIds.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                    Evidence
                  </h3>
                  <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                    {memory.evidenceIds.slice(0, 20).map((evidenceId) => (
                      <p key={evidenceId} className="truncate">
                        {evidenceId}
                      </p>
                    ))}
                    {memory.evidenceIds.length > 20 && (
                      <p>+{memory.evidenceIds.length - 20} more</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function GateDots({ settings }: { settings: AgentMemorySettings }) {
  const gates = [
    ["A", "Evidence", settings.releaseGates.evidenceLedger],
    ["B", "Formation", settings.releaseGates.formation],
    ["C", "Shadow", settings.releaseGates.shadowRetrieval],
    ["D", "Chat", settings.releaseGates.chatMemory],
    ["E", "Reflection", settings.releaseGates.reflection],
    ["F", "Proactivity", settings.releaseGates.proactivity],
  ] as const;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Gates
      </span>
      {gates.map(([key, label, enabled]) => (
        <span
          key={key}
          title={`Gate ${key} ${label}: ${gateLabel(enabled)}`}
          className={`inline-block size-1.5 rounded-full ${
            enabled ? "bg-emerald-600" : "bg-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

const ACTIONABLE_INSIGHT_STATUSES = new Set([
  "pending",
  "delivered",
  "snoozed",
]);

function InsightInbox({
  insights,
  proactivityEnabled,
  onAct,
}: {
  insights: AgentInsight[];
  proactivityEnabled: boolean;
  onAct: (
    insight: AgentInsight,
    action: "dismiss" | "snooze" | "useful",
  ) => void;
}) {
  // Contradictions get their own authoritative panel below the insight list —
  // hide the (rate-limited, legacy) insight duplicates of the same records.
  const visible = insights.filter(
    (insight) => insight.category !== "memory-contradiction",
  );
  if (visible.length === 0) {
    return (
      <EmptyRow
        text={
          proactivityEnabled
            ? "No insights yet — the next sweep will fill the inbox"
            : "Proactivity (Gate F) is disabled"
        }
      />
    );
  }
  const ordered = [...visible].sort((left, right) => {
    const leftOpen = left.status === "pending" ? 0 : 1;
    const rightOpen = right.status === "pending" ? 0 : 1;
    if (leftOpen !== rightOpen) return leftOpen - rightOpen;
    return right.createdAt.localeCompare(left.createdAt);
  });
  return (
    <div className="divide-y border-y">
      {!proactivityEnabled && (
        <p className="py-2 text-xs text-muted-foreground">
          Proactivity (Gate F) is disabled — no new insights are generated.
        </p>
      )}
      {ordered.map((insight) => {
        const actionable = ACTIONABLE_INSIGHT_STATUSES.has(insight.status);
        return (
          <div key={insight.id} className="flex min-w-0 items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{insight.title}</span>
                <Badge variant="outline">{insight.category}</Badge>
                {insight.delivery === "silent-draft" && (
                  <Badge variant="secondary">draft</Badge>
                )}
                {insight.status !== "pending" && (
                  <Badge variant="secondary">{insight.status}</Badge>
                )}
              </div>
              <p className="mt-1 whitespace-pre-line text-sm">{insight.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {insight.reason}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(insight.createdAt)} / expires{" "}
                {formatDate(insight.expiresAt)} / urgency{" "}
                <span className="tabular-nums">{percent(insight.urgency)}</span>{" "}
                / confidence{" "}
                <span className="tabular-nums">
                  {percent(insight.confidence)}
                </span>{" "}
                / evidence{" "}
                <span className="tabular-nums">
                  {insight.triggerEvidenceIds.length}
                </span>
                {insight.snoozedUntil &&
                  insight.status === "snoozed" &&
                  ` / snoozed until ${formatDate(insight.snoozedUntil)}`}
              </p>
            </div>
            {actionable && (
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  title="Mark insight as useful"
                  onClick={() => onAct(insight, "useful")}
                >
                  <ThumbsUp />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Snooze insight for a day"
                  onClick={() => onAct(insight, "snooze")}
                >
                  <Clock />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Dismiss insight"
                  onClick={() => onAct(insight, "dismiss")}
                >
                  <X />
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ContradictionPanel({
  onSelectMemory,
}: {
  onSelectMemory: (memory: AgentMemory) => void;
}) {
  const { client } = useAdmin();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AgentMemoryContradictionListResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    client
      .get<unknown>(`agent-memory/contradictions?page=${page}`)
      .then((raw) => {
        if (!active) return;
        const parsed =
          agentMemoryContradictionListResponseSchema.safeParse(raw);
        if (!parsed.success) return;
        // Archiving the last group of a page can leave us past the end.
        if (parsed.data.groups.length === 0 && parsed.data.page > 1) {
          setPage((current) => Math.max(1, current - 1));
          return;
        }
        setData(parsed.data);
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, page, refreshKey]);

  const archive = async (memory: AgentMemory) => {
    setResolvingId(memory.id);
    try {
      await client.post(`agent-memory/memories/${memory.id}`, {
        action: "archive",
        reason: "Archived while resolving a memory contradiction",
      });
      toast.success("Memory archived");
      setRefreshKey((key) => key + 1);
    } catch {
      toast.error("Archive failed");
    } finally {
      setResolvingId(null);
    }
  };

  const resolveLink = async (memory: AgentMemory, conflict: AgentMemory) => {
    setResolvingId(`${memory.id}:${conflict.id}`);
    try {
      await client.post(`agent-memory/memories/${memory.id}`, {
        action: "resolve-contradiction",
        targetMemoryId: conflict.id,
        reason: "Owner marked the statements as compatible",
      });
      toast.success("Marked as not a conflict");
      setRefreshKey((key) => key + 1);
    } catch {
      toast.error("Resolving the contradiction failed");
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="mt-8">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
        Memory contradictions
      </h3>
      <p className="mb-2 mt-1 text-xs text-muted-foreground">
        Every active memory below conflicts with the records listed under it.
        Open a statement for full detail, archive the outdated side, or mark the
        pair as not a conflict when both statements are true.
      </p>
      {loading && !data ? (
        <div className="space-y-2 border-y py-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : !data || data.total === 0 ? (
        <p className="border-y py-3 text-sm text-muted-foreground">
          No unresolved memory contradictions
        </p>
      ) : (
        <>
          <div className="divide-y border-y">
            {data.groups.map((group) => (
              <div key={group.memory.id} className="py-3">
                <div className="flex min-w-0 items-start gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectMemory(group.memory)}
                    className="min-w-0 flex-1 break-words text-left text-sm font-medium hover:underline"
                  >
                    {group.memory.statement}
                  </button>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {percent(group.memory.confidence)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-xs"
                    disabled={resolvingId !== null}
                    onClick={() => void archive(group.memory)}
                  >
                    {resolvingId === group.memory.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      "Archive"
                    )}
                  </Button>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  updated {formatDate(group.memory.updatedAt)} · conflicts with{" "}
                  <span className="tabular-nums">{group.conflicts.length}</span>{" "}
                  active record(s)
                </p>
                <div className="mt-2 space-y-2 border-l-2 pl-3">
                  {group.conflicts.map((conflict) => (
                    <div
                      key={conflict.id}
                      className="flex min-w-0 items-start gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => onSelectMemory(conflict)}
                        className="min-w-0 flex-1 break-words text-left text-sm hover:underline"
                      >
                        {conflict.statement}
                      </button>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {percent(conflict.confidence)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 shrink-0 px-2 text-xs"
                        disabled={resolvingId !== null}
                        title="Both statements are true — remove the contradiction link"
                        onClick={() => void resolveLink(group.memory, conflict)}
                      >
                        {resolvingId === `${group.memory.id}:${conflict.id}` ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          "Not a conflict"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 shrink-0 px-2 text-xs"
                        disabled={resolvingId !== null}
                        onClick={() => void archive(conflict)}
                      >
                        {resolvingId === conflict.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          "Archive"
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <PageFooter
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            label="contradictions"
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function MemoryTable({
  memories,
  onSelect,
}: {
  memories: AgentMemory[];
  onSelect: (memory: AgentMemory) => void;
}) {
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
            <TableRow
              key={memory.id}
              className="cursor-pointer"
              onClick={() => onSelect(memory)}
            >
              <TableCell className="max-w-xl whitespace-normal font-medium">
                <p className="line-clamp-2">{memory.statement}</p>
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
  selected,
  disabled,
  onToggle,
  onTogglePage,
  onDecide,
}: {
  candidates: AgentMemoryCandidate[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (candidateId: string) => void;
  onTogglePage: (selectAll: boolean) => void;
  onDecide: (
    candidate: AgentMemoryCandidate,
    action: "accept" | "dismiss",
  ) => void;
}) {
  if (candidates.length === 0)
    return <EmptyRow text="No candidates awaiting review" />;
  const allSelected = candidates.every((candidate) =>
    selected.has(candidate.id),
  );
  return (
    <div className="overflow-x-auto border-y">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => onTogglePage(checked === true)}
                aria-label="Select all candidates on this page"
                disabled={disabled}
              />
            </TableHead>
            <TableHead>Proposal</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => (
            <TableRow
              key={candidate.id}
              data-state={selected.has(candidate.id) ? "selected" : undefined}
            >
              <TableCell>
                <Checkbox
                  checked={selected.has(candidate.id)}
                  onCheckedChange={() => onToggle(candidate.id)}
                  aria-label="Select candidate"
                  disabled={disabled}
                />
              </TableCell>
              <TableCell className="max-w-lg whitespace-normal font-medium">
                <p className="line-clamp-2">{candidate.statement}</p>
              </TableCell>
              <TableCell className="max-w-sm whitespace-normal text-muted-foreground">
                <p className="line-clamp-2">{candidate.reason}</p>
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
                    disabled={disabled}
                    onClick={() => onDecide(candidate, "accept")}
                  >
                    <Check />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Dismiss candidate"
                    disabled={disabled}
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
            <TableHead className="w-10">
              <span className="sr-only">Toggle full log</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RunRow({ run }: { run: AgentMemoryRun }) {
  const [expanded, setExpanded] = useState(false);
  const toggleLabel = expanded ? "Collapse run log" : "Show full run log";
  return (
    <>
      <TableRow>
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
        <TableCell className="w-10">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
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
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6}>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all border-l-2 pl-3 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(run, null, 2)}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </>
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

const FORMATION_MODEL_DEFAULT = "__default__";
const RETRIEVAL_MAX_ITEM_OPTIONS = [4, 8, 12, 20, 30, 50];
const RETRIEVAL_MAX_TOKEN_OPTIONS = [
  1_000, 1_500, 2_500, 4_000, 6_000, 8_000, 10_000,
];

function useModelCatalog() {
  const { client } = useAdmin();
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await client.get<{
          models?: { id: string; name: string; tags?: string[] }[];
        }>("llm/models?requiredCapability=tool-use");
        if (!cancelled) setModels(raw.models ?? []);
      } catch {
        // Catalog cold or unreachable — the free-form value still renders.
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  return { models, modelsLoading };
}

function ResourceSuggestionInbox({
  suggestions,
  enabled,
  generating,
  onGenerate,
  onDecide,
}: {
  suggestions: AgentResourceSuggestion[];
  enabled: boolean;
  generating: boolean;
  onGenerate: (model?: string) => void;
  onDecide: (
    suggestion: AgentResourceSuggestion,
    action: "accept" | "dismiss",
    draft?: AgentPersonDraft,
  ) => void;
}) {
  const { models } = useModelCatalog();
  const [modelOverride, setModelOverride] = useState(FORMATION_MODEL_DEFAULT);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={modelOverride} onValueChange={setModelOverride}>
          <SelectTrigger className="h-7 w-64 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FORMATION_MODEL_DEFAULT} className="text-xs">
              Configured model
            </SelectItem>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id} className="text-xs">
                {model.name} · {model.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={generating}
          onClick={() =>
            onGenerate(
              modelOverride === FORMATION_MODEL_DEFAULT
                ? undefined
                : modelOverride,
            )
          }
        >
          {generating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Generate suggestions
        </Button>
        {!enabled && (
          <span className="text-xs text-muted-foreground">
            Daily sweep is off — enable it in settings or generate on demand.
          </span>
        )}
      </div>

      {suggestions.length === 0 ? (
        <EmptyRow text="No pending suggestions — recurring people in memories surface here as ready-to-review person records" />
      ) : (
        <div className="divide-y border-y">
          {suggestions.map((suggestion) => (
            <SuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              onDecide={onDecide}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionRow({
  suggestion,
  onDecide,
}: {
  suggestion: AgentResourceSuggestion;
  onDecide: (
    suggestion: AgentResourceSuggestion,
    action: "accept" | "dismiss",
    draft?: AgentPersonDraft,
  ) => void;
}) {
  const [draft, setDraft] = useState<AgentPersonDraft>({
    ...suggestion.draft,
  });
  // Mirror the server's completeness bar so an accept never bounces: full
  // name (two tokens), relation to the owner, and notes.
  const complete =
    draft.name.trim().split(/\s+/).length >= 2 &&
    draft.relationToOwner.trim().length > 0 &&
    draft.notes.trim().length > 0;
  const contact = [draft.email, draft.phone, draft.website, draft.placeMet]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{suggestion.entityLabel}</span>
        <Badge variant="outline">{suggestion.resourceType}</Badge>
        <span className="text-xs text-muted-foreground">
          confidence{" "}
          <span className="tabular-nums">{percent(suggestion.confidence)}</span>{" "}
          · from{" "}
          <span className="tabular-nums">{suggestion.memoryIds.length}</span>{" "}
          memories · {suggestion.model}
        </span>
        <div className="ml-auto flex shrink-0 gap-1">
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!complete}
            title={
              complete
                ? "Create the person record"
                : "Needs a full name, a relation to you, and notes"
            }
            onClick={() => onDecide(suggestion, "accept", draft)}
          >
            <Check className="size-3.5" />
            Create person
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => onDecide(suggestion, "dismiss")}
          >
            <X className="size-3.5" />
            Dismiss
          </Button>
        </div>
      </div>
      {suggestion.existingResourceMatches.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Possible existing match:{" "}
          {suggestion.existingResourceMatches
            .map((match) => match.name)
            .join(", ")}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label
          htmlFor={`suggestion-${suggestion.id}-name`}
          className="space-y-1 text-xs text-muted-foreground"
        >
          Name
          <Input
            id={`suggestion-${suggestion.id}-name`}
            value={draft.name}
            className="h-7 text-xs"
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, name: event.target.value }))
            }
          />
        </label>
        <label
          htmlFor={`suggestion-${suggestion.id}-relation`}
          className="space-y-1 text-xs text-muted-foreground"
        >
          Relation to you
          <Input
            id={`suggestion-${suggestion.id}-relation`}
            value={draft.relationToOwner}
            className="h-7 text-xs"
            onChange={(event) =>
              setDraft((prev) => ({
                ...prev,
                relationToOwner: event.target.value,
              }))
            }
          />
        </label>
      </div>
      <label
        htmlFor={`suggestion-${suggestion.id}-notes`}
        className="block space-y-1 text-xs text-muted-foreground"
      >
        Notes
        <Textarea
          id={`suggestion-${suggestion.id}-notes`}
          value={draft.notes}
          rows={3}
          className="text-xs"
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, notes: event.target.value }))
          }
        />
      </label>
      {contact && <p className="text-xs text-muted-foreground">{contact}</p>}
      <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
    </div>
  );
}

function SettingsPanel({
  settings,
  onUpdate,
}: {
  settings: AgentMemorySettings;
  onUpdate: (patch: Record<string, unknown>, reason: string) => Promise<void>;
}) {
  const { models, modelsLoading } = useModelCatalog();

  const formationValue = settings.formationModel ?? FORMATION_MODEL_DEFAULT;
  const knownModel = models.some(
    (model) => model.id === settings.formationModel,
  );

  return (
    <div className="max-w-2xl space-y-8">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Formation model</h3>
          <p className="text-xs text-muted-foreground">
            LLM used to extract memory candidates from evidence.
          </p>
        </div>
        <Select
          value={formationValue}
          onValueChange={(value) =>
            void onUpdate(
              {
                formationModel:
                  value === FORMATION_MODEL_DEFAULT ? null : value,
              },
              `Set formation model to ${value === FORMATION_MODEL_DEFAULT ? "server default" : value}`,
            )
          }
        >
          <SelectTrigger className="h-8 w-full max-w-md text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FORMATION_MODEL_DEFAULT} className="text-xs">
              Server default (semantic model)
            </SelectItem>
            {settings.formationModel && !knownModel && (
              <SelectItem value={settings.formationModel} className="text-xs">
                {settings.formationModel} (current)
              </SelectItem>
            )}
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id} className="text-xs">
                {model.name} · {model.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {modelsLoading && (
          <p className="text-xs text-muted-foreground">
            Loading model catalog…
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Retrieval budget</h3>
          <p className="text-xs text-muted-foreground">
            Caps how much memory context is injected into a chat request: the
            maximum number of retrieved memories and the serialized token budget
            (shared with the derived profile context).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(settings.retrieval.maxRetrievedItems)}
            onValueChange={(value) =>
              void onUpdate(
                {
                  retrieval: {
                    ...settings.retrieval,
                    maxRetrievedItems: Number(value),
                  },
                },
                `Max injected memories set to ${value}`,
              )
            }
          >
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!RETRIEVAL_MAX_ITEM_OPTIONS.includes(
                settings.retrieval.maxRetrievedItems,
              ) && (
                <SelectItem
                  value={String(settings.retrieval.maxRetrievedItems)}
                  className="text-xs"
                >
                  Up to {settings.retrieval.maxRetrievedItems} memories
                  (current)
                </SelectItem>
              )}
              {RETRIEVAL_MAX_ITEM_OPTIONS.map((option) => (
                <SelectItem
                  key={option}
                  value={String(option)}
                  className="text-xs"
                >
                  Up to {option} memories
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(settings.retrieval.maxTokens)}
            onValueChange={(value) =>
              void onUpdate(
                {
                  retrieval: {
                    ...settings.retrieval,
                    maxTokens: Number(value),
                  },
                },
                `Retrieval token budget set to ${value}`,
              )
            }
          >
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!RETRIEVAL_MAX_TOKEN_OPTIONS.includes(
                settings.retrieval.maxTokens,
              ) && (
                <SelectItem
                  value={String(settings.retrieval.maxTokens)}
                  className="text-xs"
                >
                  {settings.retrieval.maxTokens.toLocaleString()} tokens
                  (current)
                </SelectItem>
              )}
              {RETRIEVAL_MAX_TOKEN_OPTIONS.map((option) => (
                <SelectItem
                  key={option}
                  value={String(option)}
                  className="text-xs"
                >
                  {option.toLocaleString()} tokens
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Review policy</h3>
          <p className="text-xs text-muted-foreground">
            Single-user mode auto-accepts safe candidates and only queues
            low-confidence email-only proposals for review. Conservative mode
            restores the strict multi-flag review pipeline. Hard safety rules
            (secrets, permission-like statements) always apply.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={settings.promotion.mode}
            onValueChange={(value) =>
              void onUpdate(
                {
                  promotion: { ...settings.promotion, mode: value },
                },
                `Set promotion mode to ${value}`,
              )
            }
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single-user" className="text-xs">
                Single-user
              </SelectItem>
              <SelectItem value="conservative" className="text-xs">
                Conservative
              </SelectItem>
            </SelectContent>
          </Select>
          {settings.promotion.mode === "single-user" && (
            <Select
              value={String(settings.promotion.emailReviewMaxConfidence)}
              onValueChange={(value) =>
                void onUpdate(
                  {
                    promotion: {
                      ...settings.promotion,
                      emailReviewMaxConfidence: Number(value),
                    },
                  },
                  `Email review threshold set to ${value}`,
                )
              }
            >
              <SelectTrigger className="h-8 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.5" className="text-xs">
                  Review email below 50%
                </SelectItem>
                <SelectItem value="0.7" className="text-xs">
                  Review email below 70%
                </SelectItem>
                <SelectItem value="0.85" className="text-xs">
                  Review email below 85%
                </SelectItem>
                <SelectItem value="1" className="text-xs">
                  Review all email memories
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Consolidation</h3>
          <p className="text-xs text-muted-foreground">
            A recurring sweep clusters near-duplicate memories, supersedes
            outdated facts with their current version, and rewrites statements
            to refer to the owner as “Admin”. Proposals at or above the
            auto-apply threshold are applied by policy (revisioned and
            rollbackable); everything below waits in the review inbox.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={settings.consolidation.enabled ? "enabled" : "disabled"}
            onValueChange={(value) =>
              void onUpdate(
                {
                  consolidation: {
                    ...settings.consolidation,
                    enabled: value === "enabled",
                  },
                },
                `Consolidation ${value}`,
              )
            }
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="enabled" className="text-xs">
                Enabled
              </SelectItem>
              <SelectItem value="disabled" className="text-xs">
                Disabled
              </SelectItem>
            </SelectContent>
          </Select>
          {settings.consolidation.enabled && (
            <>
              <Select
                value={String(settings.consolidation.autoApplyThreshold)}
                onValueChange={(value) =>
                  void onUpdate(
                    {
                      consolidation: {
                        ...settings.consolidation,
                        autoApplyThreshold: Number(value),
                      },
                    },
                    `Consolidation auto-apply threshold set to ${value}`,
                  )
                }
              >
                <SelectTrigger className="h-8 w-56 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5" className="text-xs">
                    Auto-apply at 50% confidence
                  </SelectItem>
                  <SelectItem value="0.6" className="text-xs">
                    Auto-apply at 60% confidence
                  </SelectItem>
                  <SelectItem value="0.7" className="text-xs">
                    Auto-apply at 70% confidence
                  </SelectItem>
                  <SelectItem value="0.8" className="text-xs">
                    Auto-apply at 80% confidence
                  </SelectItem>
                  <SelectItem value="0.9" className="text-xs">
                    Auto-apply at 90% confidence
                  </SelectItem>
                  <SelectItem value="0.95" className="text-xs">
                    Auto-apply at 95% confidence
                  </SelectItem>
                  <SelectItem value="1" className="text-xs">
                    Auto-apply only at 100%
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={String(settings.consolidation.batchSize)}
                onValueChange={(value) =>
                  void onUpdate(
                    {
                      consolidation: {
                        ...settings.consolidation,
                        batchSize: Number(value),
                      },
                    },
                    `Consolidation batch size set to ${value}`,
                  )
                }
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20" className="text-xs">
                    20 memories/run
                  </SelectItem>
                  <SelectItem value="40" className="text-xs">
                    40 memories/run
                  </SelectItem>
                  <SelectItem value="80" className="text-xs">
                    80 memories/run
                  </SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Resource suggestions</h3>
          <p className="text-xs text-muted-foreground">
            A recurring sweep drafts complete person records from people who
            keep surfacing in memories (full name, relation to you, notes).
            Drafts always wait in the Suggestions inbox for manual approval —
            nothing is created automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={
              settings.resourceSuggestions.enabled ? "enabled" : "disabled"
            }
            onValueChange={(value) =>
              void onUpdate(
                {
                  resourceSuggestions: {
                    ...settings.resourceSuggestions,
                    enabled: value === "enabled",
                  },
                },
                `Resource suggestion sweep ${value}`,
              )
            }
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="enabled" className="text-xs">
                Enabled
              </SelectItem>
              <SelectItem value="disabled" className="text-xs">
                Disabled
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={
              settings.resourceSuggestions.model ?? FORMATION_MODEL_DEFAULT
            }
            onValueChange={(value) =>
              void onUpdate(
                {
                  resourceSuggestions: {
                    ...settings.resourceSuggestions,
                    model: value === FORMATION_MODEL_DEFAULT ? null : value,
                  },
                },
                `Set resource suggestion model to ${value === FORMATION_MODEL_DEFAULT ? "server default" : value}`,
              )
            }
          >
            <SelectTrigger className="h-8 w-full max-w-md text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FORMATION_MODEL_DEFAULT} className="text-xs">
                Server default (semantic model)
              </SelectItem>
              {settings.resourceSuggestions.model &&
                !models.some(
                  (model) => model.id === settings.resourceSuggestions.model,
                ) && (
                  <SelectItem
                    value={settings.resourceSuggestions.model}
                    className="text-xs"
                  >
                    {settings.resourceSuggestions.model} (current)
                  </SelectItem>
                )}
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id} className="text-xs">
                  {model.name} · {model.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="space-y-1 text-xs text-muted-foreground">
        <p>
          Reflection schedule:{" "}
          <span className="font-mono">
            {settings.reflectionSchedule ?? "manual"}
          </span>{" "}
          · Max insights/day:{" "}
          <span className="tabular-nums">
            {settings.proactivity.maxInsightsPerDay}
          </span>{" "}
          · Autonomy:{" "}
          <span className="font-mono">{settings.maximumActionAutonomy}</span>
        </p>
        <p>
          Settings revision{" "}
          <span className="tabular-nums">{settings.revision}</span> · updated{" "}
          {formatDate(settings.updatedAt)}
        </p>
      </section>
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
