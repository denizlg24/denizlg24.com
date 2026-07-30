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
  agentResourceSuggestionMemoriesResponseSchema,
  agentRetrievalTraceListResponseSchema,
  bulkAgentCandidateDecisionResponseSchema,
  generateAgentResourceSuggestionsResponseSchema,
} from "@repo/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
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
  Link2,
  List,
  Loader2,
  Orbit,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Terminal,
  ThumbsUp,
  Trash2,
  Undo2,
  Unlink,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { ExploreDock } from "./explore-dock";
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
        {/* Disabled to match the live header's first render, which starts in
            the loading state — otherwise hydrating over this skeleton reports
            an attribute mismatch. */}
        <Button
          size="icon"
          variant="ghost"
          disabled
          title="Refresh memory data"
        >
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
            <TabsTrigger
              value="explore"
              className="h-5.5 px-2 text-xs"
              title="Explore view"
            >
              <Terminal className="size-3.5" />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <RefreshCw className="size-4 animate-spin" />
          Loading memory data…
        </span>
      </div>
    </div>
  );
}

interface OverviewMeta {
  totalMemories: number;
  totalCandidates: number;
  pendingCandidates: number;
  nextMemoryCursor: string | null;
  nextCandidateCursor: string | null;
  pageSize: number;
}

interface OverviewQuery {
  memoryCursor: string | null;
  candidateCursor: string | null;
  memoryStatus: string;
  memoryType: string;
  memorySort: string;
  candidateSort: string;
}

const DEFAULT_OVERVIEW_QUERY: OverviewQuery = {
  memoryCursor: null,
  candidateCursor: null,
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
  const [view, setView] = useState<"graph" | "list" | "explore">("graph");
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
  const [contradictionRefreshGen, setContradictionRefreshGen] = useState(0);
  const queryRef = useRef<OverviewQuery>({ ...DEFAULT_OVERVIEW_QUERY });

  const applyOverview = useCallback((overview: AgentMemoryListResponse) => {
    setMemories(overview.memories);
    setCandidates(overview.candidates);
    setSettings(overview.settings);
    setMeta({
      totalMemories: overview.totalMemories,
      totalCandidates: overview.totalCandidates,
      pendingCandidates: overview.pendingCandidates,
      nextMemoryCursor: overview.nextMemoryCursor,
      nextCandidateCursor: overview.nextCandidateCursor,
      pageSize: overview.pageSize,
    });
    setSelectedCandidateIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(overview.candidates.map((candidate) => candidate.id));
      return new Set([...prev].filter((id) => ids.has(id)));
    });
  }, []);

  // Cursors of the pages before the current one, so "previous" can rewind
  // without offset pagination. Page number = trail length + 1.
  const memoryTrailRef = useRef<(string | null)[]>([]);
  const candidateTrailRef = useRef<(string | null)[]>([]);

  const fetchOverview = useCallback(async () => {
    const query = queryRef.current;
    const params = new URLSearchParams({
      status: query.memoryStatus,
      memorySort: query.memorySort,
      candidateSort: query.candidateSort,
    });
    if (query.memoryCursor) params.set("memoryCursor", query.memoryCursor);
    if (query.candidateCursor)
      params.set("candidateCursor", query.candidateCursor);
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
      patch.memoryCursor = null;
      memoryTrailRef.current = [];
    }
    if ("candidateSort" in patch) {
      patch.candidateCursor = null;
      candidateTrailRef.current = [];
    }
    Object.assign(queryRef.current, patch);
    setFilters({ ...queryRef.current });
    try {
      await fetchOverview();
    } catch {
      toast.error("Failed to load list");
    }
  };

  const turnPage = (list: "memory" | "candidate", direction: 1 | -1) => {
    const isMemory = list === "memory";
    const trail = isMemory ? memoryTrailRef.current : candidateTrailRef.current;
    let cursor: string | null;
    if (direction === 1) {
      const next = isMemory
        ? meta?.nextMemoryCursor
        : meta?.nextCandidateCursor;
      if (!next) return;
      trail.push(
        isMemory
          ? queryRef.current.memoryCursor
          : queryRef.current.candidateCursor,
      );
      cursor = next;
    } else {
      if (trail.length === 0) return;
      cursor = trail.pop() ?? null;
    }
    void updateQuery(
      isMemory ? { memoryCursor: cursor } : { candidateCursor: cursor },
    );
  };

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      else setRefreshing(true);
      // Traces and reflection are heavy payloads — populate them when they
      // arrive instead of holding the whole list view hostage; the skeleton
      // gate only waits for the overview.
      const secondary = (async () => {
        try {
          const [tracesRaw, reflectionRaw, insightsRaw, suggestionList] =
            await Promise.all([
              client.get<unknown>("agent-memory/retrieval-traces?limit=100"),
              client.get<unknown>("agent-memory/reflection"),
              client.get<unknown>("agent-memory/insights"),
              // Isolated: a failure or parse error here must not blank traces,
              // reflection, and insights — keep the previous inbox instead.
              client
                .get<unknown>(
                  "agent-memory/resource-suggestions?status=pending",
                )
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
            current &&
            traceList.traces.some((trace) => trace.traceId === current)
              ? current
              : (traceList.traces[0]?.traceId ?? null),
          );
        } catch {
          toast.error("Failed to load agent memory data");
        }
      })();
      try {
        await fetchOverview();
        // Propagate refresh to ContradictionPanel.
        setContradictionRefreshGen((gen) => gen + 1);
      } catch {
        toast.error("Failed to load agent memory data");
      } finally {
        setLoading(false);
      }
      await secondary;
      setRefreshing(false);
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
    action: "accept" | "attach" | "dismiss",
    options?: { draft?: AgentPersonDraft; resourceId?: string },
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
            : action === "attach"
              ? "Attached existing person from resource suggestion review"
              : "Dismissed from resource suggestion review",
        ...(action === "accept" && options?.draft
          ? { draft: options.draft }
          : {}),
        ...(action === "attach" && options?.resourceId
          ? { resourceId: options.resourceId }
          : {}),
      });
      toast.success(
        action === "accept"
          ? `Created and attached ${(options?.draft ?? suggestion.draft).name}`
          : action === "attach"
            ? "Existing person attached"
            : "Suggestion dismissed",
      );
      void load(true);
    } catch {
      setSuggestions(previousSuggestions);
      setSuggestionStats(previousStats);
      toast.error("Suggestion decision failed");
    }
  };

  const splitSuggestionMemory = async (
    suggestion: AgentResourceSuggestion,
    memoryId: string,
  ): Promise<boolean> => {
    try {
      await client.post(`agent-memory/resource-suggestions/${suggestion.id}`, {
        action: "split-memory",
        memoryId,
        reason:
          "Separated a related memory that refers to a different person with the same extracted name",
      });
      toast.success("Memory separated into a new person suggestion");
      void load(true);
      return true;
    } catch {
      toast.error("Failed to separate related memory");
      return false;
    }
  };

  const generateSuggestions = async () => {
    setGeneratingSuggestions(true);
    try {
      const raw = await client.post<unknown>(
        "agent-memory/resource-suggestions",
        {},
      );
      const result = generateAgentResourceSuggestionsResponseSchema.parse(raw);
      if (result.created === 0) {
        toast.info(
          `Suggestions are current — ${result.skipped} people are already suggested, dismissed, or attached`,
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

  // Only the list view needs the overview/traces/reflection round trips —
  // never hold the graph (usually prefetched) or the explore dock (fetches
  // per probe) hostage to them.
  if (loading && view === "list") return <AgentMemorySkeleton />;

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
          disabled={refreshing || loading}
          title="Refresh memory data"
        >
          <RefreshCw
            className={refreshing || loading ? "animate-spin" : undefined}
          />
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Tabs
          value={view}
          onValueChange={(value) =>
            setView(value as "graph" | "list" | "explore")
          }
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
            <TabsTrigger
              value="explore"
              className="h-5.5 px-2 text-xs"
              title="Explore view"
            >
              <Terminal className="size-3.5" />
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
          view === "graph" &&
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
        ) : view === "explore" ? (
          <ExploreDock onSelect={setSelectedMemory} />
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
                <ContradictionPanel
                  onSelectMemory={setSelectedMemory}
                  refreshGen={contradictionRefreshGen}
                />
              </>
            )}

            {section === "memories" && (
              <>
                <MemoryTable memories={memories} onSelect={setSelectedMemory} />
                {meta && (
                  <PageFooter
                    page={memoryTrailRef.current.length + 1}
                    pageSize={meta.pageSize}
                    total={meta.totalMemories}
                    label="memories"
                    hasNext={meta.nextMemoryCursor !== null}
                    onTurn={(direction) => turnPage("memory", direction)}
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
                    page={candidateTrailRef.current.length + 1}
                    pageSize={meta.pageSize}
                    total={meta.totalCandidates}
                    label="candidates"
                    hasNext={meta.nextCandidateCursor !== null}
                    onTurn={(direction) => turnPage("candidate", direction)}
                  />
                )}
              </>
            )}

            {section === "suggestions" && (
              <ResourceSuggestionInbox
                suggestions={suggestions}
                generating={generatingSuggestions}
                onGenerate={generateSuggestions}
                onDecide={decideSuggestion}
                onSplitMemory={splitSuggestionMemory}
                onSelectMemory={setSelectedMemory}
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
              <ProcedureTable
                procedures={reflection?.procedures ?? []}
                onDeleted={() => void load(true)}
              />
            )}

            {section === "runs" && <RunTable runs={reflection?.runs ?? []} />}

            {section === "traces" && (
              <TraceExplorer
                traces={traces}
                selected={selectedTrace}
                onSelect={setSelectedTraceId}
              />
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
  hasNext,
  onTurn,
}: {
  page: number;
  pageSize: number;
  total: number;
  label: string;
  hasNext: boolean;
  onTurn: (direction: 1 | -1) => void;
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
          onClick={() => onTurn(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Next page"
          disabled={!hasNext}
          onClick={() => onTurn(1)}
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
  refreshGen,
}: {
  onSelectMemory: (memory: AgentMemory) => void;
  refreshGen: number;
}) {
  const { client } = useAdmin();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AgentMemoryContradictionListResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    client
      .get<unknown>(`agent-memory/contradictions?page=${page}`)
      .then((raw) => {
        if (!active) return;
        const parsed =
          agentMemoryContradictionListResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setError(true);
          return;
        }
        // Archiving the last group of a page can leave us past the end.
        if (parsed.data.groups.length === 0 && parsed.data.page > 1) {
          setPage((current) => Math.max(1, current - 1));
          return;
        }
        setData(parsed.data);
      })
      .catch(() => {
        if (active) {
          setData(null);
          setError(true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, page, refreshKey, refreshGen]);

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
      ) : error ? (
        <p className="border-y py-3 text-sm text-destructive">
          Failed to load contradictions
        </p>
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
            hasNext={data.page < Math.ceil(data.total / data.pageSize)}
            onTurn={(direction) => setPage(data.page + direction)}
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
            {revisions.map((revision) => {
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
                      {formatDate(revision.createdAt)} / +{revision.chunksAdded}{" "}
                      / -{revision.chunksRemoved} / {revision.reason}
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

function ProcedureTable({
  procedures,
  onDeleted,
}: {
  procedures: AgentProcedure[];
  onDeleted: () => void;
}) {
  const { client } = useAdmin();
  const [deleteTarget, setDeleteTarget] = useState<AgentProcedure | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await client.del(`agent-memory/procedures/${deleteTarget.id}`);
      toast.success("Procedure deleted");
      setDeleteTarget(null);
      onDeleted();
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(false);
    }
  };

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
            <TableHead className="w-8">
              <span className="sr-only">Actions</span>
            </TableHead>
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
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete procedure: ${procedure.scope}`}
                  onClick={() => setDeleteTarget(procedure)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete procedure?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.behavior}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
      <div className="min-w-0 border-b lg:border-r lg:border-b-0">
        {traces.map((trace) => (
          <button
            type="button"
            key={trace.traceId}
            onClick={() => onSelect(trace.traceId)}
            className={`flex w-full flex-col gap-1 border-b px-3 py-3 text-left hover:bg-muted/50 ${selected?.traceId === trace.traceId ? "bg-muted" : ""}`}
          >
            <span className="line-clamp-2 break-words text-sm font-medium">
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

function ResourceSuggestionInbox({
  suggestions,
  generating,
  onGenerate,
  onDecide,
  onSplitMemory,
  onSelectMemory,
}: {
  suggestions: AgentResourceSuggestion[];
  generating: boolean;
  onGenerate: () => void;
  onDecide: (
    suggestion: AgentResourceSuggestion,
    action: "accept" | "attach" | "dismiss",
    options?: { draft?: AgentPersonDraft; resourceId?: string },
  ) => void;
  onSplitMemory: (
    suggestion: AgentResourceSuggestion,
    memoryId: string,
  ) => Promise<boolean>;
  onSelectMemory: (memory: AgentMemory) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={generating}
          onClick={onGenerate}
        >
          {generating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Refresh suggestions
        </Button>
      </div>

      {suggestions.length === 0 ? (
        <EmptyRow text="Every person in the memory graph is attached, dismissed, or already reviewed" />
      ) : (
        <div className="space-y-2">
          {suggestions.map((suggestion) => (
            <SuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              onDecide={onDecide}
              onSplitMemory={onSplitMemory}
              onSelectMemory={onSelectMemory}
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
  onSplitMemory,
  onSelectMemory,
}: {
  suggestion: AgentResourceSuggestion;
  onDecide: (
    suggestion: AgentResourceSuggestion,
    action: "accept" | "attach" | "dismiss",
    options?: { draft?: AgentPersonDraft; resourceId?: string },
  ) => void;
  onSplitMemory: (
    suggestion: AgentResourceSuggestion,
    memoryId: string,
  ) => Promise<boolean>;
  onSelectMemory: (memory: AgentMemory) => void;
}) {
  const { client } = useAdmin();
  const [draft, setDraft] = useState<AgentPersonDraft>({
    ...suggestion.draft,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [relatedMemories, setRelatedMemories] = useState<AgentMemory[] | null>(
    null,
  );
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [splittingMemoryId, setSplittingMemoryId] = useState<string | null>(
    null,
  );
  const complete = draft.name.trim().length > 0;

  const toggleMemories = async () => {
    const nextOpen = !memoriesOpen;
    setMemoriesOpen(nextOpen);
    if (!nextOpen) {
      setRelatedMemories(null);
      return;
    }
    if (relatedMemories || memoriesLoading) return;
    setMemoriesLoading(true);
    try {
      const raw = await client.get<unknown>(
        `agent-memory/resource-suggestions/${suggestion.id}`,
      );
      const parsed = agentResourceSuggestionMemoriesResponseSchema.parse(raw);
      setRelatedMemories(parsed.memories);
    } catch {
      setMemoriesOpen(false);
      toast.error("Failed to load related memories");
    } finally {
      setMemoriesLoading(false);
    }
  };

  const splitMemory = async (memoryId: string) => {
    setSplittingMemoryId(memoryId);
    const split = await onSplitMemory(suggestion, memoryId);
    if (split) {
      setRelatedMemories(
        (current) =>
          current?.filter((memory) => memory.id !== memoryId) ?? current,
      );
    }
    setSplittingMemoryId(null);
  };

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {suggestion.entityLabel}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Unattached person · {suggestion.memoryIds.length}{" "}
            {suggestion.memoryIds.length === 1 ? "memory" : "memories"}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {suggestion.existingResourceMatches.map((match) => (
            <Button
              key={match.resourceId}
              size="sm"
              variant="outline"
              className="h-7 min-w-0 max-w-48 text-xs"
              title={`Attach this graph entity to ${match.name}`}
              onClick={() =>
                onDecide(suggestion, "attach", {
                  resourceId: match.resourceId,
                })
              }
            >
              <Link2 className="size-3.5" />
              <span className="truncate">Attach {match.name}</span>
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setCreateOpen(true)}
          >
            <UserPlus className="size-3.5" />
            Create person
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            title="Dismiss suggestion"
            onClick={() => onDecide(suggestion, "dismiss")}
          >
            <X className="size-3.5" />
            <span className="sr-only">Dismiss</span>
          </Button>
        </div>
      </div>

      <button
        type="button"
        className="flex w-full items-center gap-1 border-t px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        onClick={() => void toggleMemories()}
      >
        {memoriesLoading ? (
          <Loader2 className="size-3 animate-spin" />
        ) : memoriesOpen ? (
          <ChevronUp className="size-3" />
        ) : (
          <ChevronDown className="size-3" />
        )}
        {memoriesOpen ? "Hide" : "Review"} related memories
      </button>

      {memoriesOpen && (
        <div className="space-y-1 border-t bg-muted/20 p-2">
          {relatedMemories?.map((memory) => (
            <div
              key={memory.id}
              className="flex items-center gap-1 rounded-sm hover:bg-muted"
            >
              <button
                type="button"
                className="min-w-0 flex-1 px-2 py-1.5 text-left"
                onClick={() => onSelectMemory(memory)}
              >
                <p className="line-clamp-2 text-xs">{memory.statement}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {memory.memoryType} · {formatDate(memory.updatedAt)}
                </p>
              </button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="mr-1 size-7 shrink-0"
                disabled={
                  suggestion.memoryIds.length <= 1 || splittingMemoryId !== null
                }
                title={
                  suggestion.memoryIds.length <= 1
                    ? "A suggestion must retain one memory"
                    : "This memory refers to a different person"
                }
                onClick={() => void splitMemory(memory.id)}
              >
                {splittingMemoryId === memory.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Unlink className="size-3" />
                )}
                <span className="sr-only">
                  Remove from this person suggestion
                </span>
              </Button>
            </div>
          ))}
          {relatedMemories?.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No related memories are still available.
            </p>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create and attach person</DialogTitle>
            <DialogDescription>
              Review the extracted name and add any details you want before
              creating the directory record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label
              htmlFor={`suggestion-${suggestion.id}-name`}
              className="block space-y-1 text-xs text-muted-foreground"
            >
              Name
              <Input
                id={`suggestion-${suggestion.id}-name`}
                value={draft.name}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </label>
            <label
              htmlFor={`suggestion-${suggestion.id}-relation`}
              className="block space-y-1 text-xs text-muted-foreground"
            >
              Relation to you
              <Input
                id={`suggestion-${suggestion.id}-relation`}
                value={draft.relationToOwner}
                placeholder="Optional"
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    relationToOwner: event.target.value,
                  }))
                }
              />
            </label>
            <label
              htmlFor={`suggestion-${suggestion.id}-notes`}
              className="block space-y-1 text-xs text-muted-foreground"
            >
              Notes
              <Textarea
                id={`suggestion-${suggestion.id}-notes`}
                value={draft.notes}
                placeholder="Optional"
                rows={4}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    notes: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              disabled={!complete}
              onClick={() => {
                onDecide(suggestion, "accept", { draft });
                setCreateOpen(false);
              }}
            >
              <UserPlus className="size-4" />
              Create and attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
