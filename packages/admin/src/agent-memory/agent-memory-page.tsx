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
  agentReflectionOverviewSchema,
  agentResourceSuggestionListResponseSchema,
  agentResourceSuggestionMemoriesResponseSchema,
  agentRetrievalTraceListResponseSchema,
  bulkAgentCandidateDecisionResponseSchema,
  generateAgentResourceSuggestionsResponseSchema,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { PaginatedDataTable } from "@repo/ui/paginated-data-table";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { Stat, StatGroup } from "@repo/ui/stat";
import { StatusDot } from "@repo/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Textarea } from "@repo/ui/textarea";
import { type FilterOption, FilterTabs, ToolbarSpacer } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  History,
  Link2,
  List as ListIcon,
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
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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

type MemoryView = "graph" | "list" | "explore";

type MemorySection =
  | "inbox"
  | "memories"
  | "review"
  | "suggestions"
  | "profile"
  | "goals"
  | "procedures"
  | "runs"
  | "traces";

const VIEW_OPTIONS: FilterOption<MemoryView>[] = [
  {
    value: "graph",
    label: (
      <>
        <Orbit className="size-3.5" />
        Graph
      </>
    ),
  },
  {
    value: "list",
    label: (
      <>
        <ListIcon className="size-3.5" />
        List
      </>
    ),
  },
  {
    value: "explore",
    label: (
      <>
        <Terminal className="size-3.5" />
        Explore
      </>
    ),
  },
];

const MEMORY_ICON = <BrainCircuit />;

export function AgentMemorySkeleton({
  view = "graph",
}: {
  view?: MemoryView;
} = {}) {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={MEMORY_ICON}
        title="Agent memory"
      >
        {/* Disabled to match the live header's first render, which starts in
            the loading state — otherwise hydrating over this skeleton reports
            an attribute mismatch. */}
        <Button size="icon-sm" variant="ghost" disabled aria-label="Refresh">
          <RefreshCw />
        </Button>
      </PageHeader>
      <PageToolbar>
        <FilterTabs
          value={view}
          onChange={() => undefined}
          options={VIEW_OPTIONS}
        />
      </PageToolbar>
      {view === "list" ? (
        <PageBody width="wide">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex flex-col gap-1.5 py-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        </PageBody>
      ) : (
        <PageBody bleed>
          <EmptyState icon={<Spinner />} label="Loading" className="h-full" />
        </PageBody>
      )}
    </Page>
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
  const { client, slots, routes } = useAdmin();
  const router = useRouter();
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
  const [view, setView] = useState<MemoryView>("graph");
  const [section, setSection] = useState<MemorySection>("inbox");
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
    // The detail page loads by id, so a link is all this has to be — the local
    // lookup and the fallback fetch both moved there.
    (memoryId: string) => {
      router.push(routes.agentMemory.detail(memoryId));
    },
    [router, routes],
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
  if (loading && view === "list") return <AgentMemorySkeleton view="list" />;

  const selectedTrace = traces.find(
    (trace) => trace.traceId === selectedTraceId,
  );

  const sectionOptions: FilterOption<MemorySection>[] = [
    { value: "inbox", label: "Inbox", count: insightStats?.pending },
    { value: "memories", label: "Memories", count: meta?.totalMemories },
    { value: "review", label: "Review", count: meta?.totalCandidates },
    {
      value: "suggestions",
      label: "Suggestions",
      count: suggestionStats?.pending,
    },
    { value: "profile", label: "Profile" },
    { value: "goals", label: "Goals", count: reflection?.goals.length },
    {
      value: "procedures",
      label: "Procedures",
      count: reflection?.procedures.length,
    },
    { value: "runs", label: "Runs", count: reflection?.runs.length },
    { value: "traces", label: "Traces", count: traces.length },
  ];

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={MEMORY_ICON}
        title="Agent memory"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh"
          onClick={() => {
            void load(true);
            if (graphRequestedRef.current) void loadGraph({ force: true });
          }}
          disabled={refreshing || loading}
        >
          <RefreshCw
            className={cn((refreshing || loading) && "animate-spin")}
          />
        </Button>
      </PageHeader>

      <PageToolbar>
        <FilterTabs value={view} onChange={setView} options={VIEW_OPTIONS} />
        {view === "list" ? (
          <>
            <span aria-hidden className="h-4 w-px bg-border" />
            <FilterTabs
              value={section}
              onChange={setSection}
              options={sectionOptions}
              className="flex-wrap"
            />
          </>
        ) : view === "graph" && graph ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {graph.nodes.length} nodes · {graph.links.length} links ·{" "}
            {graph.embeddedCount} embedded
          </span>
        ) : null}
        <ToolbarSpacer />
        {settings && <GateDots settings={settings} />}
      </PageToolbar>

      {view === "graph" ? (
        <PageBody bleed>
          {graph ? (
            <MemoryGraph
              nodes={graph.nodes}
              links={graph.links}
              onSelectMemory={openMemory}
            />
          ) : (
            <EmptyState
              className="h-full"
              icon={graphLoading ? <Spinner /> : <Orbit />}
              label={graphLoading ? "Building graph" : "No graph"}
              action={
                graphLoading ? undefined : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void loadGraph()}
                  >
                    Load
                  </Button>
                )
              }
            />
          )}
        </PageBody>
      ) : view === "explore" ? (
        <PageBody bleed>
          <ExploreDock onSelect={(memory) => openMemory(memory.id)} />
        </PageBody>
      ) : (
        <PageBody width="wide">
          {section === "inbox" && (
            <>
              <InsightInbox
                insights={insights}
                proactivityEnabled={settings?.releaseGates.proactivity ?? false}
                onAct={actOnInsight}
              />
              <ContradictionPanel
                onSelectMemory={(memory) => openMemory(memory.id)}
                refreshGen={contradictionRefreshGen}
              />
            </>
          )}

          {section === "memories" && (
            <Section
              title="Memories"
              count={meta?.totalMemories}
              actions={
                <>
                  <Select
                    value={filters.memoryStatus}
                    onValueChange={(value) =>
                      void updateQuery({ memoryStatus: value })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-32"
                      aria-label="Status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="superseded">Superseded</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={filters.memoryType}
                    onValueChange={(value) =>
                      void updateQuery({ memoryType: value })
                    }
                  >
                    <SelectTrigger size="sm" className="w-32" aria-label="Type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="core">Core</SelectItem>
                      <SelectItem value="semantic">Semantic</SelectItem>
                      <SelectItem value="episodic">Episodic</SelectItem>
                      <SelectItem value="reflection">Reflection</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={filters.memorySort}
                    onValueChange={(value) =>
                      void updateQuery({ memorySort: value })
                    }
                  >
                    <SelectTrigger size="sm" className="w-36" aria-label="Sort">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="importance">By importance</SelectItem>
                      <SelectItem value="confidence">By confidence</SelectItem>
                      <SelectItem value="recent">Most recent</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              }
            >
              <MemoryTable
                memories={memories}
                onSelect={(memory) => openMemory(memory.id)}
              />
              {meta && meta.totalMemories > 0 && (
                <PageFooter
                  page={memoryTrailRef.current.length + 1}
                  pageSize={meta.pageSize}
                  total={meta.totalMemories}
                  hasNext={meta.nextMemoryCursor !== null}
                  onTurn={(direction) => turnPage("memory", direction)}
                />
              )}
            </Section>
          )}

          {section === "review" && (
            <Section
              title="Candidates"
              count={meta?.totalCandidates}
              actions={
                <>
                  {selectedCandidateIds.size > 0 && (
                    <>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {selectedCandidateIds.size} selected
                      </span>
                      <Button
                        size="sm"
                        disabled={bulkDeciding !== null}
                        onClick={() => void decideSelected("accept")}
                      >
                        {bulkDeciding === "accept" ? <Spinner /> : <Check />}
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={bulkDeciding !== null}
                        onClick={() => void decideSelected("dismiss")}
                      >
                        {bulkDeciding === "dismiss" ? <Spinner /> : <X />}
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={bulkDeciding !== null}
                        onClick={() => setSelectedCandidateIds(new Set())}
                      >
                        Clear
                      </Button>
                    </>
                  )}
                  <Select
                    value={filters.candidateSort}
                    onValueChange={(value) =>
                      void updateQuery({ candidateSort: value })
                    }
                  >
                    <SelectTrigger size="sm" className="w-36" aria-label="Sort">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="confidence">By confidence</SelectItem>
                      <SelectItem value="recent">Most recent</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              }
            >
              <CandidateTable
                candidates={candidates}
                selected={selectedCandidateIds}
                disabled={bulkDeciding !== null}
                onToggle={toggleCandidate}
                onTogglePage={togglePageSelection}
                onDecide={decideCandidate}
              />
              {meta && meta.totalCandidates > 0 && (
                <PageFooter
                  page={candidateTrailRef.current.length + 1}
                  pageSize={meta.pageSize}
                  total={meta.totalCandidates}
                  hasNext={meta.nextCandidateCursor !== null}
                  onTurn={(direction) => turnPage("candidate", direction)}
                />
              )}
            </Section>
          )}

          {section === "suggestions" && (
            <ResourceSuggestionInbox
              suggestions={suggestions}
              generating={generatingSuggestions}
              onGenerate={generateSuggestions}
              onDecide={decideSuggestion}
              onSplitMemory={splitSuggestionMemory}
              onSelectMemory={(memory) => openMemory(memory.id)}
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

          {section === "goals" && <GoalTable goals={reflection?.goals ?? []} />}

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
        </PageBody>
      )}
    </Page>
  );
}

/** Cursor pagination: the API only walks forward, so the trail rewinds. */
function PageFooter({
  page,
  pageSize,
  total,
  hasNext,
  onTurn,
}: {
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
  onTurn: (direction: 1 | -1) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs tabular-nums text-muted-foreground">
        {page} / {totalPages}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onTurn(-1)}
      >
        <ChevronLeft />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Next page"
        disabled={!hasNext}
        onClick={() => onTurn(1)}
      >
        <ChevronRight />
      </Button>
    </div>
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
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Gates
      </span>
      {gates.map(([key, label, enabled]) => (
        <span key={key} title={`${key} ${label}: ${gateLabel(enabled)}`}>
          <StatusDot
            tone={enabled ? "good" : "muted"}
            label={`Gate ${key} ${label} ${gateLabel(enabled)}`}
            className="size-1.5"
          />
        </span>
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
  const ordered = [...visible].sort((left, right) => {
    const leftOpen = left.status === "pending" ? 0 : 1;
    const rightOpen = right.status === "pending" ? 0 : 1;
    if (leftOpen !== rightOpen) return leftOpen - rightOpen;
    return right.createdAt.localeCompare(left.createdAt);
  });
  return (
    <Section
      title="Insights"
      count={visible.length}
      actions={
        proactivityEnabled ? undefined : (
          <Badge variant="secondary">Gate F off</Badge>
        )
      }
    >
      {ordered.length === 0 ? (
        <EmptyState compact label="No insights" />
      ) : (
        <List divided>
          {ordered.map((insight) => {
            const actionable = ACTIONABLE_INSIGHT_STATUSES.has(insight.status);
            return (
              <div
                key={insight.id}
                role="listitem"
                className="flex min-w-0 items-start gap-3 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-accent-strong">
                      {insight.title}
                    </span>
                    <Badge variant="outline">{insight.category}</Badge>
                    {insight.delivery === "silent-draft" && (
                      <Badge variant="secondary">draft</Badge>
                    )}
                    {insight.status !== "pending" && (
                      <Badge variant="secondary">{insight.status}</Badge>
                    )}
                  </div>
                  <p className="whitespace-pre-line text-sm">{insight.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {insight.reason}
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
                    <span>{formatDate(insight.createdAt)}</span>
                    <span>expires {formatDate(insight.expiresAt)}</span>
                    <span>urgency {percent(insight.urgency)}</span>
                    <span>confidence {percent(insight.confidence)}</span>
                    <span>evidence {insight.triggerEvidenceIds.length}</span>
                    {insight.snoozedUntil && insight.status === "snoozed" && (
                      <span>
                        snoozed until {formatDate(insight.snoozedUntil)}
                      </span>
                    )}
                  </p>
                </div>
                {actionable && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Useful"
                      onClick={() => onAct(insight, "useful")}
                    >
                      <ThumbsUp />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Snooze 1d"
                      onClick={() => onAct(insight, "snooze")}
                    >
                      <Clock />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Dismiss"
                      onClick={() => onAct(insight, "dismiss")}
                    >
                      <X />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </List>
      )}
    </Section>
  );
}

function ContradictionLine({
  memory,
  primary = false,
  onOpen,
  children,
}: {
  memory: AgentMemory;
  primary?: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "min-w-0 flex-1 break-words text-left text-sm transition-colors hover:text-accent-strong hover:underline",
          primary ? "font-medium text-accent-strong" : "text-foreground",
        )}
      >
        {memory.statement}
      </button>
      <span className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
        {percent(memory.confidence)}
      </span>
      {children}
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

  const archiveButton = (memory: AgentMemory) => (
    <Button
      size="xs"
      variant="ghost"
      className="shrink-0"
      disabled={resolvingId !== null}
      onClick={() => void archive(memory)}
    >
      {resolvingId === memory.id ? <Spinner /> : <Archive />}
      Archive
    </Button>
  );

  return (
    <Section title="Contradictions" count={data?.total}>
      {loading && !data ? (
        <div className="flex flex-col gap-2 py-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error ? (
        <p className="py-2 text-sm text-destructive">
          Failed to load contradictions
        </p>
      ) : !data || data.total === 0 ? (
        <EmptyState compact label="No contradictions" />
      ) : (
        <>
          <List divided>
            {data.groups.map((group) => (
              <div
                key={group.memory.id}
                role="listitem"
                className="flex flex-col gap-2 py-3"
              >
                <ContradictionLine
                  memory={group.memory}
                  primary
                  onOpen={() => onSelectMemory(group.memory)}
                >
                  {archiveButton(group.memory)}
                </ContradictionLine>
                <p className="text-xs tabular-nums text-muted-foreground">
                  updated {formatDate(group.memory.updatedAt)} ·{" "}
                  {group.conflicts.length}{" "}
                  {group.conflicts.length === 1 ? "conflict" : "conflicts"}
                </p>
                <div className="flex flex-col gap-1.5 border-l pl-3">
                  {group.conflicts.map((conflict) => (
                    <ContradictionLine
                      key={conflict.id}
                      memory={conflict}
                      onOpen={() => onSelectMemory(conflict)}
                    >
                      <Button
                        size="xs"
                        variant="ghost"
                        className="shrink-0"
                        disabled={resolvingId !== null}
                        onClick={() => void resolveLink(group.memory, conflict)}
                      >
                        {resolvingId === `${group.memory.id}:${conflict.id}` ? (
                          <Spinner />
                        ) : (
                          <Link2 />
                        )}
                        Not a conflict
                      </Button>
                      {archiveButton(conflict)}
                    </ContradictionLine>
                  ))}
                </div>
              </div>
            ))}
          </List>
          <PageFooter
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            hasNext={data.page < Math.ceil(data.total / data.pageSize)}
            onTurn={(direction) => setPage(data.page + direction)}
          />
        </>
      )}
    </Section>
  );
}

function MemoryTable({
  memories,
  onSelect,
}: {
  memories: AgentMemory[];
  onSelect: (memory: AgentMemory) => void;
}) {
  if (memories.length === 0) return <EmptyState compact label="No memories" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Statement</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="hidden md:table-cell">Trust</TableHead>
          <TableHead className="text-right">Confidence</TableHead>
          <TableHead className="hidden text-right md:table-cell">
            Evidence
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {memories.map((memory) => (
          <TableRow
            key={memory.id}
            className="cursor-pointer"
            tabIndex={0}
            onClick={() => onSelect(memory)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSelect(memory);
            }}
          >
            <TableCell className="max-w-xl whitespace-normal text-accent-strong">
              <p className="line-clamp-2">{memory.statement}</p>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{memory.memoryType}</Badge>
            </TableCell>
            <TableCell className="hidden text-muted-foreground md:table-cell">
              {memory.trust}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {percent(memory.confidence)}
            </TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">
              {memory.evidenceIds.length}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
    return <EmptyState compact label="No candidates" />;
  const allSelected = candidates.every((candidate) =>
    selected.has(candidate.id),
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => onTogglePage(checked === true)}
              aria-label="Select page"
              disabled={disabled}
            />
          </TableHead>
          <TableHead>Proposal</TableHead>
          <TableHead className="hidden md:table-cell">Reason</TableHead>
          <TableHead className="hidden lg:table-cell">Flags</TableHead>
          <TableHead className="w-20">
            <span className="sr-only">Actions</span>
          </TableHead>
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
            <TableCell className="max-w-lg whitespace-normal text-accent-strong">
              <p className="line-clamp-2">{candidate.statement}</p>
            </TableCell>
            <TableCell className="hidden max-w-sm whitespace-normal text-muted-foreground md:table-cell">
              <p className="line-clamp-2">{candidate.reason}</p>
            </TableCell>
            <TableCell className="hidden lg:table-cell">
              <div className="flex flex-wrap gap-1">
                {candidate.reviewFlags.map((flag) => (
                  <Badge key={flag} variant="secondary">
                    {flag}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-0.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Accept"
                  disabled={disabled}
                  onClick={() => onDecide(candidate, "accept")}
                >
                  <Check />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Dismiss"
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
  const sections = model
    ? Object.entries(model.sections).filter(([, chunks]) => chunks.length > 0)
    : [];
  return (
    <>
      <Section
        title="Profile"
        actions={
          <Button size="sm" onClick={onRun} disabled={running}>
            {running ? <Spinner /> : <Play />}
            Run reflection
          </Button>
        }
      >
        {model ? (
          <Properties>
            <Property label="Revision">
              <span className="tabular-nums">{model.revision}</span>
            </Property>
            <Property label="Generated">
              {formatDate(model.generatedAt)}
            </Property>
          </Properties>
        ) : (
          <EmptyState compact label="No projection" />
        )}
      </Section>

      {sections.map(([section, chunks]) => (
        <Section key={section} title={section} count={chunks.length}>
          <div className="flex flex-col gap-2">
            {chunks.map((chunk) => (
              <div
                key={chunk.key}
                className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <p className="min-w-0 break-words">{chunk.statement}</p>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {chunk.explicitness} · {percent(chunk.confidence)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      ))}

      <Section title="Revisions" count={revisions.length}>
        {revisions.length === 0 ? (
          <EmptyState compact icon={<History />} label="No revisions" />
        ) : (
          <List divided>
            {revisions.map((revision) => {
              const isCurrent = revision.revision === model?.revision;
              return (
                <ListRow
                  key={revision.id}
                  className="mx-0"
                  title={`Revision ${revision.revision}`}
                  description={
                    <span title={revision.reason}>
                      {formatDate(revision.createdAt)} · +{revision.chunksAdded}{" "}
                      / −{revision.chunksRemoved} · {revision.reason}
                    </span>
                  }
                  meta={
                    <>
                      <Badge variant="outline">{revision.createdBy}</Badge>
                      {isCurrent && <Badge variant="secondary">current</Badge>}
                    </>
                  }
                  trailing={
                    isCurrent ? undefined : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Restore revision ${revision.revision}`}
                        onClick={() => onRollback(revision.revision)}
                        disabled={rollingBackRevision !== null}
                      >
                        {rollingBackRevision === revision.revision ? (
                          <Spinner />
                        ) : (
                          <Undo2 />
                        )}
                      </Button>
                    )
                  }
                />
              );
            })}
          </List>
        )}
      </Section>
    </>
  );
}

const goalColumns: ColumnDef<AgentGoal>[] = [
  {
    accessorKey: "title",
    header: "Goal",
    cell: ({ row }) => (
      <div className="max-w-xl whitespace-normal">
        <p className="text-accent-strong">{row.original.title}</p>
        {row.original.description && (
          <p className="text-xs text-muted-foreground">
            {row.original.description}
          </p>
        )}
      </div>
    ),
  },
  {
    accessorKey: "kind",
    header: "Kind",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.kind}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
  },
  {
    accessorKey: "targetUntil",
    header: "Target",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.targetUntil ? formatDate(row.original.targetUntil) : "—"}
      </span>
    ),
  },
  {
    accessorKey: "revision",
    header: () => <div className="text-right">Rev</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.revision}</div>
    ),
  },
];

function GoalTable({ goals }: { goals: AgentGoal[] }) {
  return (
    <Section title="Goals" count={goals.length}>
      <PaginatedDataTable
        columns={goalColumns}
        data={goals}
        emptyMessage="No goals"
      />
    </Section>
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

  const handleDelete = async (procedure: AgentProcedure) => {
    try {
      await client.del(`agent-memory/procedures/${procedure.id}`);
      toast.success("Procedure deleted");
      onDeleted();
    } catch {
      toast.error("Delete failed");
    }
  };

  const columns: ColumnDef<AgentProcedure>[] = [
    {
      accessorKey: "scope",
      header: "Scope",
      cell: ({ row }) => (
        <div className="max-w-48 whitespace-normal text-accent-strong">
          {row.original.scope}
        </div>
      ),
    },
    {
      accessorKey: "trigger",
      header: "Trigger",
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => (
        <div className="max-w-xs whitespace-normal text-muted-foreground">
          {row.original.trigger}
        </div>
      ),
    },
    {
      accessorKey: "behavior",
      header: "Behavior",
      cell: ({ row }) => (
        <div className="max-w-lg whitespace-normal">
          {row.original.behavior}
        </div>
      ),
    },
    {
      accessorKey: "lifecycle",
      header: "Lifecycle",
      meta: { className: "hidden md:table-cell" },
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.lifecycle}</Badge>
      ),
    },
    {
      accessorKey: "confidence",
      header: () => <div className="text-right">Confidence</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {percent(row.original.confidence)}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Delete procedure: ${row.original.scope}`}
            onClick={() => setDeleteTarget(row.original)}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Section title="Procedures" count={procedures.length}>
      <PaginatedDataTable
        columns={columns}
        data={procedures}
        emptyMessage="No procedures"
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete procedure?"
        description={deleteTarget?.behavior}
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
      />
    </Section>
  );
}

const RUN_STATUS_VARIANT: Record<
  AgentMemoryRun["status"],
  "good" | "critical" | "warning" | "secondary"
> = {
  completed: "good",
  failed: "critical",
  running: "warning",
  cancelled: "secondary",
};

const runColumns: ColumnDef<AgentMemoryRun>[] = [
  {
    accessorKey: "startedAt",
    header: "Started",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatDate(row.original.startedAt)}</span>
    ),
  },
  {
    accessorKey: "operation",
    header: "Operation",
    meta: { className: "hidden md:table-cell" },
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.operation}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={RUN_STATUS_VARIANT[row.original.status]}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    id: "inputs",
    header: () => <div className="text-right">Inputs</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {row.original.inputIds.length}
      </div>
    ),
  },
  {
    id: "outputs",
    header: () => <div className="text-right">Outputs</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {row.original.outputIds.length}
      </div>
    ),
  },
  {
    accessorKey: "promptVersion",
    header: "Version",
    meta: { className: "hidden lg:table-cell" },
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.promptVersion}
      </span>
    ),
  },
];

function RunTable({ runs }: { runs: AgentMemoryRun[] }) {
  const [openRun, setOpenRun] = useState<AgentMemoryRun | null>(null);
  return (
    <Section title="Runs" count={runs.length}>
      <PaginatedDataTable
        columns={runColumns}
        data={runs}
        emptyMessage="No runs"
        onRowClick={setOpenRun}
      />
      <Dialog
        open={openRun !== null}
        onOpenChange={(open) => {
          if (!open) setOpenRun(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {openRun
                ? `${openRun.operation} · ${formatDate(openRun.startedAt)}`
                : "Run"}
            </DialogTitle>
          </DialogHeader>
          {openRun ? (
            <pre className="min-w-0 whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
              {JSON.stringify(openRun, null, 2)}
            </pre>
          ) : null}
        </DialogContent>
      </Dialog>
    </Section>
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
  return (
    <Section title="Traces" count={traces.length}>
      {traces.length === 0 ? (
        <EmptyState compact label="No traces" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.6fr)]">
          <List className="min-w-0">
            {traces.map((trace) => (
              <ListRow
                key={trace.traceId}
                className="mx-0"
                selected={selected?.traceId === trace.traceId}
                onClick={() => onSelect(trace.traceId)}
                title={trace.query}
                description={`${formatDate(trace.createdAt)} · ${trace.candidates.length} candidates`}
                meta={
                  trace.abstained ? (
                    <Badge variant="outline">abstained</Badge>
                  ) : undefined
                }
              />
            ))}
          </List>
          <div className="min-w-0">
            {selected && <TraceDetail trace={selected} />}
          </div>
        </div>
      )}
    </Section>
  );
}

function TraceDetail({ trace }: { trace: AgentRetrievalTrace }) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-6 overflow-hidden">
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Search className="size-3.5 shrink-0" />
          <span className="shrink-0">{trace.purpose}</span>
          <span className="min-w-0 truncate font-mono" title={trace.traceId}>
            {trace.traceId}
          </span>
        </div>
        <p className="text-sm font-medium text-accent-strong">{trace.query}</p>
      </div>
      <StatGroup>
        <Stat label="Candidates" value={trace.candidates.length} />
        <Stat label="Selected" value={trace.selectedRevisionIds.length} />
        <Stat
          label="Tokens"
          value={trace.estimatedTokens}
          hint={`of ${trace.tokenBudget}`}
        />
        <Stat label="Injected" value={trace.injected ? "yes" : "no"} />
      </StatGroup>
      <TraceCandidates
        candidates={trace.candidates}
        selectedIds={trace.selectedRevisionIds}
      />
      <Section title="Exclusions" count={trace.exclusions.length}>
        {trace.exclusions.length === 0 ? (
          <EmptyState compact label="No exclusions" />
        ) : (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-l pl-3 text-xs">
            {JSON.stringify(trace.exclusions, null, 2)}
          </pre>
        )}
      </Section>
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
  return (
    <Section title="Ranked" count={candidates.length}>
      {candidates.length === 0 ? (
        <EmptyState compact label="No candidates" />
      ) : (
        <div className="flex flex-col gap-2">
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
      )}
    </Section>
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
    <div
      className={cn(
        "min-w-0 max-w-full overflow-hidden border-l px-3 py-1.5",
        selected && "border-accent-strong",
      )}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2">
        <p
          className={cn(
            "min-w-0 break-words text-sm",
            !expanded && "line-clamp-2",
          )}
        >
          {statement}
        </p>
        <Badge variant={selected ? "info" : "outline"}>
          {score.toFixed(3)}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={toggleLabel}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
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
        className={cn(
          "mt-1 max-w-full text-[11px] text-muted-foreground",
          expanded ? "break-all" : "truncate",
        )}
      >
        evidence {evidence}
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
    <Section
      title="People"
      count={suggestions.length}
      actions={
        <Button
          size="sm"
          variant="ghost"
          disabled={generating}
          onClick={onGenerate}
        >
          {generating ? <Spinner /> : <Sparkles />}
          Refresh
        </Button>
      }
    >
      {suggestions.length === 0 ? (
        <EmptyState compact label="No suggestions" />
      ) : (
        <List divided>
          {suggestions.map((suggestion) => (
            <SuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              onDecide={onDecide}
              onSplitMemory={onSplitMemory}
              onSelectMemory={onSelectMemory}
            />
          ))}
        </List>
      )}
    </Section>
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
  const memoryCount = suggestion.memoryIds.length;

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
    <div role="listitem" className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-accent-strong">
            {suggestion.entityLabel}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {memoryCount} {memoryCount === 1 ? "memory" : "memories"}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1">
          {suggestion.existingResourceMatches.map((match) => (
            <Button
              key={match.resourceId}
              size="sm"
              variant="outline"
              className="min-w-0 max-w-48"
              onClick={() =>
                onDecide(suggestion, "attach", {
                  resourceId: match.resourceId,
                })
              }
            >
              <Link2 />
              <span className="truncate">Attach {match.name}</span>
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateOpen(true)}
          >
            <UserPlus />
            Create person
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => onDecide(suggestion, "dismiss")}
          >
            <X />
          </Button>
        </div>
      </div>

      <Button
        size="xs"
        variant="ghost"
        className="self-start text-muted-foreground"
        aria-expanded={memoriesOpen}
        onClick={() => void toggleMemories()}
      >
        {memoriesLoading ? (
          <Spinner />
        ) : memoriesOpen ? (
          <ChevronUp />
        ) : (
          <ChevronDown />
        )}
        {memoriesOpen ? "Hide memories" : "Memories"}
      </Button>

      {memoriesOpen && relatedMemories && (
        <List className="ml-2 border-l pl-3">
          {relatedMemories.length === 0 ? (
            <span className="py-1 text-xs text-muted-foreground">
              No memories
            </span>
          ) : (
            relatedMemories.map((memory) => (
              <ListRow
                key={memory.id}
                className="mx-0"
                onClick={() => onSelectMemory(memory)}
                title={memory.statement}
                description={`${memory.memoryType} · ${formatDate(memory.updatedAt)}`}
                trailing={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Different person"
                    disabled={memoryCount <= 1 || splittingMemoryId !== null}
                    onClick={(event) => {
                      event.stopPropagation();
                      void splitMemory(memory.id);
                    }}
                  >
                    {splittingMemoryId === memory.id ? <Spinner /> : <Unlink />}
                  </Button>
                }
              />
            ))
          )}
        </List>
      )}

      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create person"
        submitLabel="Create and attach"
        submitDisabled={!complete}
        onSubmit={() => {
          onDecide(suggestion, "accept", { draft });
          setCreateOpen(false);
        }}
      >
        <FormGrid>
          <FormField label="Name" htmlFor={`suggestion-${suggestion.id}-name`}>
            <Input
              id={`suggestion-${suggestion.id}-name`}
              value={draft.name}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </FormField>
          <FormField
            label="Relation"
            htmlFor={`suggestion-${suggestion.id}-relation`}
          >
            <Input
              id={`suggestion-${suggestion.id}-relation`}
              value={draft.relationToOwner}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  relationToOwner: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField
            label="Notes"
            htmlFor={`suggestion-${suggestion.id}-notes`}
            className="sm:col-span-2"
          >
            <Textarea
              id={`suggestion-${suggestion.id}-notes`}
              value={draft.notes}
              rows={8}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  notes: event.target.value,
                }))
              }
            />
          </FormField>
        </FormGrid>
      </FormDialog>
    </div>
  );
}
