"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { macrosEnteredUnitSchema } from "@repo/schemas/macros";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { cn } from "@repo/ui/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flame, Plus, Search as SearchIcon, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type ChangeEvent,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  dateFromIsoDate,
  dedupePendingFoods,
  formatHourLabel,
  getPendingCalories,
  HeaderChips,
  inferMealType,
  NavTabs,
  type PendingFood,
  PendingFoodsSheet,
  takeFailedPendingFoods,
  useEntryDate,
} from "@/app/app/add/_components/add-food-shared";
import { useFoodHistory } from "@/lib/app-cache/api";
import {
  type FoodHistoryItem,
  type FoodSearchItem,
  type FoodSearchParams,
  foodRevalidateResponseSchema,
  foodSearchParamsSchema,
  foodSearchResponseSchema,
  type LogFoodInput,
} from "@/lib/foods/contracts";
import {
  formatCalories,
  formatFoodQuantity,
  formatMeasureAmount,
  formatServingAmount,
} from "@/lib/foods/display";
import { FoodIcon } from "@/lib/foods/food-icon";
import {
  readPendingFoods,
  subscribeToPendingFoods,
  writePendingFoods,
} from "@/lib/foods/pending-foods";
import type { OptimisticDailyMacros } from "@/lib/optimistic-nutrition";
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary";
import {
  getCachedFoodSearch,
  putCachedFoodSearch,
  updateCachedFoodItems,
} from "../_lib/food-search-cache";
import { FoodDetailDrawer, type FoodSummary } from "./food-detail-drawer";
import type { EnteredMeasure } from "./nutrition-detail-drawer";
import { useLogPendingFoods } from "./use-log-pending-foods";

interface FoodSearchState {
  query: string;
  timePicks: FoodHistoryItem[];
  history: FoodHistoryItem[];
  results: FoodSearchItem[];
  isLoadingHistory: boolean;
  isSearching: boolean;
  isLogging: boolean;
  showingCachedResults: boolean;
  error: string | null;
  fetchedAt: string | null;
}

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  const body: unknown = await response.json();
  return body;
}

function getSearchParams(query: string): FoodSearchParams | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = foodSearchParamsSchema.safeParse({
    q: trimmed,
    limit: 50,
  });

  return parsed.success ? parsed.data : null;
}

export function useAddFoodLogic() {
  const requestSeq = useRef(0);
  const foodHistoryQuery = useFoodHistory(20);
  const [state, setState] = useState<FoodSearchState>({
    query: "",
    timePicks: [],
    history: [],
    results: [],
    isLoadingHistory: true,
    isSearching: false,
    isLogging: false,
    showingCachedResults: false,
    error: null,
    fetchedAt: null,
  });

  const revalidateCachedItems = useCallback(
    async (itemIds: string[], activeRequest: number) => {
      if (itemIds.length === 0) {
        return;
      }

      const response = await fetch("/api/foods/revalidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds }),
      });
      const body = foodRevalidateResponseSchema.parse(
        await readJsonResponse(response),
      );
      const items = body.items.map((result) => result.item);

      await updateCachedFoodItems(items, body.fetchedAt);

      if (requestSeq.current === activeRequest) {
        setState((current) => ({
          ...current,
          results: current.results.map(
            (item) => items.find((updated) => updated.id === item.id) ?? item,
          ),
          fetchedAt: body.fetchedAt,
        }));
      }
    },
    [],
  );

  const searchFoods = useCallback(
    async (query: string) => {
      const params = getSearchParams(query);
      const activeRequest = requestSeq.current + 1;
      requestSeq.current = activeRequest;

      setState((current) => ({
        ...current,
        query,
        isSearching: !!params,
        showingCachedResults: false,
        results: params ? current.results : [],
        error: null,
      }));

      if (!params) {
        return;
      }

      const cached = await getCachedFoodSearch(params);
      if (cached && requestSeq.current === activeRequest) {
        setState((current) => ({
          ...current,
          results: cached.items,
          showingCachedResults: true,
          fetchedAt: cached.fetchedAt,
        }));

        revalidateCachedItems(cached.itemIds, activeRequest).catch(() => {});
      }

      try {
        const url = new URL("/api/foods/search", window.location.origin);
        url.searchParams.set("q", params.q ?? "");
        url.searchParams.set("limit", params.limit.toString());

        const response = await fetch(url, { cache: "no-store" });
        const body = foodSearchResponseSchema.parse(
          await readJsonResponse(response),
        );

        await putCachedFoodSearch(params, body.items, body.fetchedAt);

        if (requestSeq.current === activeRequest) {
          setState((current) => ({
            ...current,
            results: body.items,
            isSearching: false,
            showingCachedResults: false,
            fetchedAt: body.fetchedAt,
          }));
        }
      } catch (error) {
        if (requestSeq.current === activeRequest) {
          setState((current) => ({
            ...current,
            isSearching: false,
            error:
              error instanceof Error ? error.message : "Failed to search foods",
          }));
        }
      }
    },
    [revalidateCachedItems],
  );

  const historyItems = foodHistoryQuery.data?.items ?? [];
  const isLoadingHistory = foodHistoryQuery.isPending;
  const refetchHistory = foodHistoryQuery.refetch;
  const historyError =
    foodHistoryQuery.isError && foodHistoryQuery.error instanceof Error
      ? foodHistoryQuery.error.message
      : foodHistoryQuery.isError
        ? "Failed to load history"
        : null;
  return useMemo(
    () => ({
      ...state,
      error: state.error ?? historyError,
      history: historyItems,
      isLoadingHistory,
      timePicks: historyItems.slice(0, 5),
      searchFoods,
      refreshHistory: () => {
        void refetchHistory();
      },
    }),
    [
      state,
      historyItems,
      historyError,
      isLoadingHistory,
      refetchHistory,
      searchFoods,
    ],
  );
}

type SearchableItem = Pick<
  FoodSearchItem,
  | "id"
  | "name"
  | "brand"
  | "servingLabel"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
  | "isUserFood"
> & { iconKey?: string | null; favoriteServings?: number };

function getDefaultMeasure(item: SearchableItem): EnteredMeasure | null {
  if (!isHistoryItem(item)) return null;
  const unit = macrosEnteredUnitSchema.safeParse(item.lastEnteredUnit);
  const quantity = item.lastEnteredQuantity;
  if (!unit.success || quantity == null || quantity <= 0) return null;
  return { quantity, unit: unit.data };
}

function fmtMacro(value: number | null) {
  if (value == null) return "0";
  return Math.round(value).toString();
}

function fmtServingInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "1";
  return formatFoodQuantity(value);
}

function isHistoryItem(item: SearchableItem): item is FoodHistoryItem {
  return "lastServingsConsumed" in item;
}

function getDefaultServings(item: SearchableItem) {
  return (
    item.favoriteServings ??
    (isHistoryItem(item) ? item.lastServingsConsumed : 1)
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <span className="font-semibold">{text}</span>;

  const regex = new RegExp(
    `(${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  const matchRegex = new RegExp(
    `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i",
  );
  const parts = text.split(regex).map((part, index) => ({
    key: `${index}-${part}`,
    part,
    matched: matchRegex.test(part),
  }));
  return (
    <span>
      {parts.map(({ key, part, matched }) => (
        <span key={key} className={matched ? "font-semibold" : "font-normal"}>
          {part}
        </span>
      ))}
    </span>
  );
}

function FoodRow({
  item,
  query,
  highlightOnly = false,
  onSelect,
  onQuickAdd,
}: {
  item: SearchableItem;
  query: string;
  highlightOnly?: boolean;
  onSelect: (item: SearchableItem) => void;
  onQuickAdd: (
    item: SearchableItem,
    servingsConsumed: number,
    measure: EnteredMeasure | null,
  ) => void;
}) {
  const [justAdded, setJustAdded] = useState(false);
  const justAddedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (justAddedTimer.current != null) {
        window.clearTimeout(justAddedTimer.current);
      }
    },
    [],
  );

  const servingsConsumed = getDefaultServings(item);
  const measure = getDefaultMeasure(item);
  const displayName = item.brand ? `${item.name} By ${item.brand}` : item.name;
  const servingLabel =
    isHistoryItem(item) && item.lastServingLabel
      ? item.lastServingLabel
      : item.servingLabel;
  const amountLabel =
    measure && measure.unit !== "serving"
      ? formatMeasureAmount(measure.quantity, measure.unit)
      : formatServingAmount(servingLabel, servingsConsumed);

  return (
    <div className="flex w-full items-center gap-2 border-b border-border/50 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
        <FoodIcon
          name={item.name}
          iconKey={item.iconKey}
          className="size-7 object-contain"
        />
      </span>
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="text-[12px] leading-tight text-foreground truncate">
          {highlightOnly ? (
            <HighlightedText text={displayName} query={query} />
          ) : (
            <span className="font-semibold">{displayName}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            {formatCalories((item.caloriesPerServing ?? 0) * servingsConsumed)}
            <Flame className="size-3" />
          </span>
          <span className="tabular-nums">
            {fmtMacro(
              item.proteinPerServing == null
                ? null
                : item.proteinPerServing * servingsConsumed,
            )}
            P
          </span>
          <span className="tabular-nums">
            {fmtMacro(
              item.fatPerServing == null
                ? null
                : item.fatPerServing * servingsConsumed,
            )}
            F
          </span>
          <span className="tabular-nums">
            {fmtMacro(
              item.carbsPerServing == null
                ? null
                : item.carbsPerServing * servingsConsumed,
            )}
            C
          </span>
          <span>•</span>
          <span className="truncate">{amountLabel}</span>
        </div>
      </button>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onQuickAdd(item, servingsConsumed, measure);
          setJustAdded(true);
          if (justAddedTimer.current != null) {
            window.clearTimeout(justAddedTimer.current);
          }
          justAddedTimer.current = window.setTimeout(
            () => setJustAdded(false),
            1200,
          );
        }}
        aria-label={`Quick add ${amountLabel} of ${displayName}`}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95",
          justAdded
            ? "bg-foreground text-background"
            : "bg-muted text-muted-foreground active:bg-muted/60",
        )}
      >
        {justAdded ? <Check className="size-4" /> : <Plus className="size-4" />}
      </button>
    </div>
  );
}

function Section({
  title,
  items,
  query,
  highlightOnly = false,
  cap = 4,
  onSelect,
  onQuickAdd,
}: {
  title: string;
  items: SearchableItem[];
  query: string;
  highlightOnly?: boolean;
  cap?: number;
  onSelect: (item: SearchableItem) => void;
  onQuickAdd: (
    item: SearchableItem,
    servingsConsumed: number,
    measure: EnteredMeasure | null,
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, cap);
  const remaining = items.length - cap;

  return (
    <section className="pt-2">
      <header className="flex items-baseline justify-between px-4 pt-2 pb-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {!expanded && remaining > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-sm text-muted-foreground underline underline-offset-2"
          >
            See {remaining} More
          </button>
        ) : null}
      </header>
      <div>
        {visible.map((item) => (
          <FoodRow
            key={item.id}
            item={item}
            query={query}
            highlightOnly={highlightOnly}
            onSelect={onSelect}
            onQuickAdd={onQuickAdd}
          />
        ))}
      </div>
    </section>
  );
}

function SearchLoadingSkeleton() {
  return (
    <div role="status" aria-live="polite" className="pt-2">
      <VisuallyHidden>Searching foods</VisuallyHidden>
      <div className="px-4 pt-2 pb-1">
        <div className="h-5 w-20 animate-pulse rounded-full bg-muted/25" />
      </div>
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-2 border-b border-border/30 px-4 py-3"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <div
              className={cn(
                "h-4 animate-pulse rounded-full bg-muted/25",
                index % 3 === 0
                  ? "w-11/12"
                  : index % 3 === 1
                    ? "w-8/12"
                    : "w-10/12",
              )}
            />
            <div className="flex items-center gap-2">
              <div className="h-3 w-8 animate-pulse rounded-full bg-muted/20" />
              <div className="h-3 w-6 animate-pulse rounded-full bg-muted/20" />
              <div className="h-3 w-6 animate-pulse rounded-full bg-muted/20" />
              <div className="h-3 w-14 animate-pulse rounded-full bg-muted/20" />
            </div>
          </div>
          <div className="h-8 w-14 shrink-0 animate-pulse rounded-full bg-muted/20" />
          <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted/20" />
        </div>
      ))}
    </div>
  );
}

function matchesQuery(item: SearchableItem, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  return (
    item.name.toLowerCase().includes(needle) ||
    (item.brand?.toLowerCase().includes(needle) ?? false)
  );
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function AddFoodLogic({
  calorieSummary,
}: {
  calorieSummary: DailyCalorieSummary;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const logic = useAddFoodLogic();
  const favoritesQuery = useQuery({
    queryKey: ["food-favorites"],
    queryFn: async () => {
      const response = await fetch("/api/foods/favorites");
      if (!response.ok) return [];
      const body = (await response.json()) as {
        items: Array<{
          sourceItemId: string;
          name: string;
          brand: string | null;
          servingLabel: string;
          defaultServings: number;
          caloriesPerServing: number | null;
          proteinPerServing: number | null;
          carbsPerServing: number | null;
          fatPerServing: number | null;
        }>;
      };
      return body.items.map(
        (item) =>
          ({
            id: item.sourceItemId,
            name: item.name,
            brand: item.brand,
            servingLabel: item.servingLabel,
            caloriesPerServing: item.caloriesPerServing,
            proteinPerServing: item.proteinPerServing,
            carbsPerServing: item.carbsPerServing,
            fatPerServing: item.fatPerServing,
            isUserFood: false,
            favoriteServings: item.defaultServings,
          }) satisfies SearchableItem,
      );
    },
  });
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const routeFocusHandledRef = useRef(false);

  const focusSearchInput = useCallback(() => {
    let frame: number | null = null;
    const timeouts: number[] = [];

    const focus = () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
    };

    frame = window.requestAnimationFrame(focus);
    timeouts.push(window.setTimeout(focus, 75));
    timeouts.push(window.setTimeout(focus, 250));
    timeouts.push(window.setTimeout(focus, 500));

    return () => {
      if (frame != null) {
        window.cancelAnimationFrame(frame);
      }
      for (const timeout of timeouts) {
        window.clearTimeout(timeout);
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("macros-add-food-scroll-lock");

    return () => {
      document.documentElement.classList.remove("macros-add-food-scroll-lock");
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const el = containerRef.current;
    if (!el) return;

    function sync() {
      if (!el) return;
      el.style.height = `${vv!.height}px`;
      el.style.transform = `translateY(${vv!.offsetTop}px)`;
    }

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);

    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);
  const [selectedFood, setSelectedFood] = useState<FoodSummary | null>(null);
  const selectFood = useCallback((item: SearchableItem) => {
    setSelectedFood({
      ...item,
      defaultServings: getDefaultServings(item),
      defaultMeasure: getDefaultMeasure(item),
    });
  }, []);
  const [pendingFoods, setPendingFoods] = useState<PendingFood[]>([]);
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false);
  const [extraConsumed, setExtraConsumed] = useState(0);
  const { isCommitting, logAllPending } = useLogPendingFoods({
    pendingFoods,
    setPendingFoods,
    setPendingSheetOpen,
    setExtraConsumed,
    today: calorieSummary.today,
  });
  const todayDate = useMemo(
    () => dateFromIsoDate(calorieSummary.today),
    [calorieSummary.today],
  );

  useEffect(() => {
    const storedFoods = readPendingFoods();
    const failedFoods = takeFailedPendingFoods();
    const initialFoods = dedupePendingFoods([...failedFoods, ...storedFoods]);

    if (initialFoods.length > 0) {
      setPendingFoods(initialFoods);
      writePendingFoods(initialFoods);
      if (failedFoods.length > 0) {
        setPendingSheetOpen(true);
      }
    }

    return subscribeToPendingFoods(setPendingFoods);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      logic.searchFoods(draft);
    }, 200);
    return () => clearTimeout(handle);
  }, [draft, logic.searchFoods]);

  useEffect(() => {
    if (
      routeFocusHandledRef.current ||
      searchParams.get("focus") !== "search"
    ) {
      return;
    }

    routeFocusHandledRef.current = true;
    return focusSearchInput();
  }, [focusSearchInput, searchParams]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    setDraft(e.target.value);

  const trimmed = draft.trim();
  const hasQuery = trimmed.length > 0;

  const [initialEntryDate] = useState(() => {
    const dateFromUrl = searchParams.get("date");
    const hourFromUrl = searchParams.get("hour");
    const initial: { date?: Date; hour?: number } = {};

    if (dateFromUrl && /^\d{4}-\d{2}-\d{2}$/.test(dateFromUrl)) {
      const parsed = new Date(dateFromUrl);
      if (parsed.toISOString().slice(0, 10) === dateFromUrl) {
        initial.date = dateFromIsoDate(dateFromUrl);
      }
    }

    if (hourFromUrl != null) {
      const parsed = Number.parseInt(hourFromUrl, 10);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 23) {
        initial.hour = parsed;
      }
    }

    return initial;
  });
  const {
    selectedDate,
    selectedHour,
    pickDate: setSelectedDate,
    setSelectedHour,
  } = useEntryDate(
    calorieSummary.today,
    calorieSummary.timezone,
    initialEntryDate,
  );
  const hourLabel = formatHourLabel(selectedHour);

  const eatenAt = useMemo(() => {
    const d = new Date(selectedDate);
    const now = new Date();
    const minute =
      d.toDateString() === now.toDateString() && selectedHour === now.getHours()
        ? Math.floor(now.getMinutes() / 15) * 15
        : 0;
    d.setHours(selectedHour, minute, 0, 0);
    return d.toISOString();
  }, [selectedDate, selectedHour]);

  const logDate = useMemo(() => {
    const d = selectedDate;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [selectedDate]);

  const pendingCalories = useMemo(
    () =>
      pendingFoods
        .filter((food) => food.input.logDate === calorieSummary.today)
        .reduce((sum, food) => sum + getPendingCalories(food), 0),
    [pendingFoods, calorieSummary.today],
  );

  const addToPending = useCallback(
    (input: LogFoodInput, macros: OptimisticDailyMacros) => {
      if (!selectedFood) return Promise.resolve();
      const clientMutationId = crypto.randomUUID();
      setPendingFoods((prev) => {
        const next = [
          ...prev,
          {
            uid: clientMutationId,
            food: selectedFood,
            input: { ...input, clientMutationId },
            macros,
          },
        ];
        window.queueMicrotask(() => writePendingFoods(next));
        return next;
      });
      return Promise.resolve();
    },
    [selectedFood],
  );

  const quickAddToPending = useCallback(
    (
      item: SearchableItem,
      servingsConsumed: number,
      measure: EnteredMeasure | null,
    ) => {
      const searchWasFocused = document.activeElement === inputRef.current;
      const clientMutationId = crypto.randomUUID();
      setPendingFoods((prev) => {
        const next = [
          ...prev,
          {
            uid: clientMutationId,
            food: item,
            input: {
              clientMutationId,
              sourceItemId: item.id,
              servingsConsumed,
              enteredQuantity: measure?.quantity,
              enteredUnit: measure?.unit,
              eatenAt,
              logDate,
              mealType: inferMealType(selectedHour),
            },
            macros: {
              calories: (item.caloriesPerServing ?? 0) * servingsConsumed,
              protein: (item.proteinPerServing ?? 0) * servingsConsumed,
              carbs: (item.carbsPerServing ?? 0) * servingsConsumed,
              fat: (item.fatPerServing ?? 0) * servingsConsumed,
            },
          },
        ];
        window.queueMicrotask(() => writePendingFoods(next));
        return next;
      });
      navigator.vibrate?.(10);

      if (searchWasFocused && document.activeElement !== inputRef.current) {
        inputRef.current?.focus({ preventScroll: true });
      }
    },
    [eatenAt, logDate, selectedHour],
  );

  const removePending = useCallback((uid: string) => {
    setPendingFoods((prev) => {
      const next = prev.filter((f) => f.uid !== uid);
      window.queueMicrotask(() => writePendingFoods(next));
      return next;
    });
  }, []);

  const fromHistory = useMemo(() => {
    if (!hasQuery) return [];
    const combined = dedupeById([...logic.timePicks, ...logic.history]);
    return combined.filter((item) => matchesQuery(item, trimmed));
  }, [hasQuery, trimmed, logic.timePicks, logic.history]);

  const historyIds = useMemo(
    () => new Set(fromHistory.map((item) => item.id)),
    [fromHistory],
  );

  const yourFoods = useMemo(
    () =>
      logic.results.filter(
        (item) => item.isUserFood && !historyIds.has(item.id),
      ),
    [logic.results, historyIds],
  );

  const yourFoodIds = useMemo(
    () => new Set(yourFoods.map((item) => item.id)),
    [yourFoods],
  );

  const common = useMemo(
    () =>
      logic.results.filter(
        (item) =>
          item.brand === null &&
          !item.isUserFood &&
          !historyIds.has(item.id) &&
          !yourFoodIds.has(item.id),
      ),
    [logic.results, historyIds, yourFoodIds],
  );

  const branded = useMemo(
    () =>
      logic.results.filter(
        (item) =>
          item.brand !== null &&
          !item.isUserFood &&
          !historyIds.has(item.id) &&
          !yourFoodIds.has(item.id),
      ),
    [logic.results, historyIds, yourFoodIds],
  );

  const picks = logic.timePicks.slice(0, 5);
  const latest = logic.history;

  return (
    <div
      ref={containerRef}
      className="macros-fixed-inset-x fixed top-0 z-50 flex flex-col overflow-hidden bg-background"
    >
      <div className="flex-none">
        <HeaderChips
          selectedDate={selectedDate}
          selectedHour={selectedHour}
          todayDate={todayDate}
          onDateChange={setSelectedDate}
          onHourChange={setSelectedHour}
          calorieSummary={{
            ...calorieSummary,
            consumed: calorieSummary.consumed + extraConsumed,
          }}
          pendingCount={pendingFoods.length}
          pendingCalories={pendingCalories}
          onViewPending={() => router.push("/app/plate")}
        />
        <NavTabs />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-24">
        {logic.error ? (
          <div className="px-4 py-3">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {logic.error}
            </div>
          </div>
        ) : null}
        {hasQuery ? (
          <Fragment>
            <Section
              title="From History"
              items={fromHistory}
              query={trimmed}
              highlightOnly
              onSelect={selectFood}
              onQuickAdd={quickAddToPending}
            />
            <Section
              title="Your Foods"
              items={yourFoods}
              query={trimmed}
              highlightOnly
              onSelect={selectFood}
              onQuickAdd={quickAddToPending}
            />
            <Section
              title="Common"
              items={common}
              query={trimmed}
              highlightOnly
              onSelect={selectFood}
              onQuickAdd={quickAddToPending}
            />
            <Section
              title="Branded"
              items={branded}
              query={trimmed}
              highlightOnly
              onSelect={selectFood}
              onQuickAdd={quickAddToPending}
            />
            {logic.isSearching ? <SearchLoadingSkeleton /> : null}
            {!logic.isSearching &&
            fromHistory.length === 0 &&
            yourFoods.length === 0 &&
            common.length === 0 &&
            branded.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No foods found for &ldquo;{trimmed}&rdquo;.
              </p>
            ) : null}
          </Fragment>
        ) : (
          <Fragment>
            <Section
              title="Favorites"
              items={favoritesQuery.data ?? []}
              query=""
              onSelect={selectFood}
              onQuickAdd={quickAddToPending}
            />
            <Section
              title={`${hourLabel} Picks`}
              items={picks}
              query=""
              cap={5}
              onSelect={selectFood}
              onQuickAdd={quickAddToPending}
            />
            <Section
              title="Latest"
              items={latest}
              query=""
              cap={20}
              onSelect={selectFood}
              onQuickAdd={quickAddToPending}
            />
            {!logic.isLoadingHistory &&
            !logic.error &&
            picks.length === 0 &&
            latest.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Log a food to start building your history.
              </p>
            ) : null}
          </Fragment>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-background px-3 pt-3 pb-safe-end">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={draft}
              onChange={onChange}
              placeholder="Search for a food"
              className={cn(
                "h-11 rounded-full bg-muted pl-9 text-base",
                draft ? "pr-10" : "pr-3",
              )}
              enterKeyHint="search"
              autoFocus={searchParams.get("focus") === "search"}
              autoComplete="off"
              inputMode="search"
            />
            {draft ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setDraft("");
                  inputRef.current?.focus({ preventScroll: true });
                }}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:bg-background/60"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <Button
            type="button"
            disabled={pendingFoods.length === 0 || isCommitting}
            onClick={logAllPending}
            className="h-11 shrink-0 rounded-full bg-foreground px-5 text-background hover:bg-foreground/90 disabled:opacity-40"
          >
            Log Foods
            {pendingFoods.length > 0 ? ` (${pendingFoods.length})` : ""}
          </Button>
        </div>
      </div>

      <FoodDetailDrawer
        food={selectedFood}
        calorieSummary={calorieSummary}
        eatenAt={eatenAt}
        logDate={logDate}
        mealType={inferMealType(selectedHour)}
        isLogging={false}
        onClose={() => setSelectedFood(null)}
        onLog={addToPending}
      />

      <PendingFoodsSheet
        open={pendingSheetOpen}
        onClose={() => setPendingSheetOpen(false)}
        pendingFoods={pendingFoods}
        onRemove={removePending}
        onCommit={logAllPending}
        isLogging={isCommitting}
      />
    </div>
  );
}
