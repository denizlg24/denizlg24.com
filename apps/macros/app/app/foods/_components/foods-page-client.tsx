"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/alert";
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
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@repo/ui/keyboard-sheet";
import { Label } from "@repo/ui/label";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import {
  ArrowLeft,
  Edit3,
  Flame,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { InlineNotice, useNotice } from "@/components/inline-notice";
import { type FlashProps, useFlash } from "@/hooks/use-flash";
import { useHydrated } from "@/hooks/use-hydrated";
import { useDailyCalorieSummary } from "@/lib/app-cache/api";
import {
  externalFoodNutritionSchema,
  type FoodSearchItem,
  foodMutationResponseSchema,
  type LogFoodInput,
  userCustomFoodsResponseSchema,
} from "@/lib/foods/contracts";
import { formatCalories } from "@/lib/foods/display";
import { FoodIcon } from "@/lib/foods/food-icon";
import type { NutrientKey } from "@/lib/foods/nutrients";
import { nutrientDefinitionsInput } from "@/lib/foods/nutrients";
import {
  readPendingFoods,
  subscribeToPendingFoods,
  writePendingFoods,
} from "@/lib/foods/pending-foods";
import { MACRO_COLORS } from "@/lib/macro-colors";
import type { OptimisticDailyMacros } from "@/lib/optimistic-nutrition";
import type { DailyCalorieSummary } from "@/lib/queries/calorie-summary";
import {
  dateFromIsoDate,
  getHourInTimezone,
  getPendingCalories,
  HeaderChips,
  inferMealType,
  NavTabs,
  type PendingFood,
  PendingFoodsSheet,
} from "../../add/_components/add-food-shared";
import {
  FoodDetailDrawer,
  type FoodSummary,
} from "../../add/_components/food-detail-drawer";
import { useLogPendingFoods } from "../../add/_components/use-log-pending-foods";
import { putUserCreatedFood } from "../../add/_lib/food-search-cache";

const foodDetailResponseSchema = z.object({
  item: z.object({
    id: z.uuid(),
    name: z.string(),
    brand: z.string().nullable(),
    iconKey: z.string().default("other-001"),
    servingLabel: z.string().nullable(),
    caloriesPerServing: z.number().nullable(),
    proteinPerServing: z.number().nullable(),
    carbsPerServing: z.number().nullable(),
    fatPerServing: z.number().nullable(),
  }),
  nutrition: externalFoodNutritionSchema,
});

const DEFAULT_ICON_KEY = "other-001";

const FoodIconPicker = dynamic(
  () =>
    import("../../scan/_components/food-icon-picker").then(
      (module) => module.FoodIconPicker,
    ),
  {
    loading: () => (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    ),
  },
);

async function readJsonResponse(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

function fmtMacro(value: number | null | undefined) {
  return Math.round(value ?? 0).toString();
}

function fmtServingInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "1";
  return Number(value.toFixed(2)).toString();
}

function matchesFood(item: FoodSearchItem, query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    item.name.toLowerCase().includes(trimmed) ||
    (item.brand?.toLowerCase().includes(trimmed) ?? false)
  );
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function FoodsFallback() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        <Skeleton className="h-9 w-24 rounded-full" />
        <div />
      </div>
      <Skeleton className="h-11 w-full rounded-none" />
      <div className="flex-1 px-4 pt-4">
        <Skeleton className="mb-4 h-11 rounded-full" />
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="flex items-center gap-2 border-b border-border/50 py-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-14 shrink-0 rounded-full" />
            <Skeleton className="size-8 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FoodRow({
  item,
  onSelect,
  onQuickAdd,
  onEdit,
  onDelete,
  deleting,
  flashProps,
}: {
  item: FoodSearchItem;
  onSelect: (item: FoodSearchItem) => void;
  onQuickAdd: (item: FoodSearchItem, servings: number) => void;
  onEdit: (item: FoodSearchItem) => void;
  onDelete: (item: FoodSearchItem) => void;
  deleting: boolean;
  flashProps: (key: string) => FlashProps;
}) {
  const servingsConsumed = 1;

  return (
    <div
      {...flashProps(item.id)}
      className="flex w-full items-center gap-3 border-b border-border/40 px-4 py-2.5"
    >
      <FoodIcon
        name={item.name}
        iconKey={item.iconKey}
        className="size-7 shrink-0 object-contain text-muted-foreground"
      />
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-[15px] leading-tight font-medium">
          {item.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-tight tabular-nums text-muted-foreground">
          <span className="inline-flex items-center gap-0.5">
            {formatCalories((item.caloriesPerServing ?? 0) * servingsConsumed)}
            <Flame className="size-2.5" />
          </span>
          <span>
            {fmtMacro((item.proteinPerServing ?? 0) * servingsConsumed)}
            <span style={{ color: MACRO_COLORS.protein }}>P</span>
          </span>
          <span>
            {fmtMacro((item.fatPerServing ?? 0) * servingsConsumed)}
            <span style={{ color: MACRO_COLORS.fat }}>F</span>
          </span>
          <span>
            {fmtMacro((item.carbsPerServing ?? 0) * servingsConsumed)}
            <span style={{ color: MACRO_COLORS.carbs }}>C</span>
          </span>
          {item.brand ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{item.brand}</span>
            </>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onQuickAdd(item, servingsConsumed)}
        aria-label={`Add ${item.name} to plate`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground active:scale-95"
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onEdit(item)}
        aria-label={`Edit ${item.name}`}
        className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onDelete(item)}
        disabled={deleting}
        aria-label={`Delete ${item.name}`}
        className="flex size-8 shrink-0 items-center justify-center text-muted-foreground active:text-destructive disabled:opacity-50"
      >
        {deleting ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Trash2 className="size-4" />
        )}
      </button>
    </div>
  );
}

function getPer100gDrafts(nutrients: Record<string, number>, grams: number) {
  const divisor = Number.isFinite(grams) && grams > 0 ? grams : 100;
  const drafts: Record<string, string> = {};
  for (const def of nutrientDefinitionsInput) {
    const value = nutrients[def.key];
    drafts[def.key] =
      value == null
        ? ""
        : Number(((value / divisor) * 100).toFixed(4)).toString();
  }
  return drafts;
}

function EditFoodDrawer({
  food,
  onClose,
  onSaved,
}: {
  food: FoodSearchItem | null;
  onClose: () => void;
  onSaved: (
    previousId: string,
    item: FoodSearchItem,
    fetchedAt: string,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [iconKey, setIconKey] = useState(DEFAULT_ICON_KEY);
  const [servingLabel, setServingLabel] = useState("1 serving");
  const [servingGrams, setServingGrams] = useState("100");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pickingIcon, setPickingIcon] = useState(false);
  const { notice, showError, show, clear } = useNotice();

  useEffect(() => {
    if (!food) return;
    let cancelled = false;
    setName(food.name);
    setBrand(food.brand ?? "");
    setIconKey(food.iconKey);
    setServingLabel(food.servingLabel ?? "1 serving");
    setServingGrams("100");
    setDrafts({});
    setPickingIcon(false);
    setIsLoading(true);

    fetch(`/api/foods/${food.id}`, { cache: "no-store" })
      .then(readJsonResponse)
      .then((body) => {
        if (cancelled) return;
        const parsed = foodDetailResponseSchema.parse(body);
        const grams = parsed.nutrition.servingQuantity;
        setName(parsed.item.name);
        setBrand(parsed.item.brand ?? "");
        setIconKey(parsed.item.iconKey);
        setServingLabel(parsed.nutrition.servingLabel);
        setServingGrams(fmtServingInput(grams));
        setDrafts(getPer100gDrafts(parsed.nutrition.nutrients, grams));
      })
      .catch((error: unknown) => {
        if (!cancelled) showError(error, "Could not load food");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [food, showError]);

  const setDraft = (key: NutrientKey, value: string) => {
    const normalized = value.replace(/,/g, ".");
    if (normalized !== "" && !/^\d*\.?\d*$/.test(normalized)) return;
    setDrafts((current) => ({ ...current, [key]: normalized }));
  };

  const save = async () => {
    if (!food) return;
    const trimmedName = name.trim();
    const trimmedServing = servingLabel.trim();
    const grams = Number.parseFloat(servingGrams);
    if (
      !trimmedName ||
      !trimmedServing ||
      !Number.isFinite(grams) ||
      grams <= 0
    ) {
      show({
        tone: "error",
        message: "Name, serving label and grams are required",
      });
      return;
    }

    const nutrients: Partial<Record<NutrientKey, number>> = {};
    for (const def of nutrientDefinitionsInput) {
      const raw = drafts[def.key];
      if (!raw) continue;
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        nutrients[def.key] = parsed;
      }
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/foods/${food.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          brand,
          iconKey,
          servingSizes: [
            { label: "100g", quantity: 100, unit: "g" },
            { label: trimmedServing, quantity: grams, unit: "g" },
          ],
          nutrients,
        }),
      });
      const body = foodMutationResponseSchema.parse(
        await readJsonResponse(response),
      );
      await putUserCreatedFood(body.item, body.fetchedAt);
      onSaved(food.id, body.item, body.fetchedAt);
      onClose();
    } catch (error) {
      showError(error, "Could not save food");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer open={food !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="z-70! flex h-[calc(100dvh-4rem)]! max-h-none! flex-col rounded-none">
        <VisuallyHidden>
          <DrawerTitle>Edit food</DrawerTitle>
          <DrawerDescription>Edit your custom food.</DrawerDescription>
        </VisuallyHidden>
        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-3">
          <button
            type="button"
            onClick={() => (pickingIcon ? setPickingIcon(false) : onClose())}
            aria-label={pickingIcon ? "Back to details" : "Close editor"}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h2 className="truncate text-sm font-semibold text-foreground">
            {pickingIcon ? "Choose icon" : "Edit food"}
          </h2>
          {isLoading ? (
            <LoaderCircle className="ml-auto size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        <InlineNotice notice={notice} onDismiss={clear} />

        {pickingIcon ? (
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <FoodIconPicker value={iconKey} onValueChange={setIconKey} />
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
            <button
              type="button"
              onClick={() => setPickingIcon(true)}
              className="flex w-full items-center gap-3 border-b border-border/50 pb-3 text-left"
            >
              <FoodIcon
                name={name}
                iconKey={iconKey}
                className="size-9 shrink-0 object-contain"
              />
              <span className="flex-1 text-sm font-medium">Icon</span>
              <span className="text-[12px] text-muted-foreground">Change</span>
            </button>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-food-name">Food name</Label>
                <Input
                  id="edit-food-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-food-brand">Brand</Label>
                <Input
                  id="edit-food-brand"
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-serving-label">Serving label</Label>
                  <Input
                    id="edit-serving-label"
                    value={servingLabel}
                    onChange={(event) => setServingLabel(event.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-serving-grams">Grams</Label>
                  <Input
                    id="edit-serving-grams"
                    value={servingGrams}
                    onChange={(event) => {
                      const normalized = event.target.value.replace(/,/g, ".");
                      if (
                        normalized !== "" &&
                        !/^\d*\.?\d*$/.test(normalized)
                      ) {
                        return;
                      }
                      setServingGrams(normalized);
                    }}
                    inputMode="decimal"
                  />
                </div>
              </div>
            </div>

            <section>
              <p className="mb-2 text-[11px] font-semibold tracking-[0.09em] uppercase text-muted-foreground">
                Nutrients per 100g
              </p>
              <div className="grid grid-cols-2 gap-2">
                {nutrientDefinitionsInput.map((def) => (
                  <div key={def.key} className="space-y-1">
                    <Label
                      htmlFor={`nutrient-${def.key}`}
                      className="text-[11px] text-muted-foreground"
                    >
                      {def.label} ({def.unit})
                    </Label>
                    <Input
                      id={`nutrient-${def.key}`}
                      value={drafts[def.key] ?? ""}
                      onChange={(event) =>
                        setDraft(def.key, event.target.value)
                      }
                      inputMode="decimal"
                      className="h-9 text-sm"
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        <div className="flex flex-none gap-2 border-t border-border bg-background px-3 pt-3 pb-safe-end">
          {pickingIcon ? (
            <Button
              type="button"
              onClick={() => setPickingIcon(false)}
              className="h-11 w-full rounded-full bg-foreground text-background hover:bg-foreground/90"
            >
              Done
            </Button>
          ) : (
            <Button
              type="button"
              onClick={save}
              disabled={isSaving || isLoading}
              className="h-11 w-full rounded-full bg-foreground text-background hover:bg-foreground/90"
            >
              {isSaving ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Saving
                </>
              ) : (
                "Save food"
              )}
            </Button>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function FoodsLogic({
  calorieSummary,
}: {
  calorieSummary: DailyCalorieSummary;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { flash, flashProps } = useFlash();
  const { notice, show, showError, clear: clearNotice } = useNotice();
  const searchParams = useSearchParams();
  const createdFoodId = searchParams.get("created");
  const [foods, setFoods] = useState<FoodSearchItem[]>([]);
  const [query, setQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState<FoodSummary | null>(null);
  const [editingFood, setEditingFood] = useState<FoodSearchItem | null>(null);
  const [pendingFoods, setPendingFoods] = useState<PendingFood[]>([]);
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false);
  const [isLoadingFoods, setIsLoadingFoods] = useState(true);
  const [foodError, setFoodError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [foodPendingDelete, setFoodPendingDelete] =
    useState<FoodSearchItem | null>(null);
  const [extraConsumed, setExtraConsumed] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() =>
    dateFromIsoDate(calorieSummary.today),
  );
  const [selectedHour, setSelectedHour] = useState(() =>
    getHourInTimezone(new Date(), calorieSummary.timezone),
  );

  const todayDate = useMemo(
    () => dateFromIsoDate(calorieSummary.today),
    [calorieSummary.today],
  );
  const eatenAt = useMemo(() => {
    const d = new Date(selectedDate);
    const nowInTz = new Date();
    const nowHourInTz = getHourInTimezone(nowInTz, calorieSummary.timezone);
    const nowDateInTz = dateFromIsoDate(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: calorieSummary.timezone,
      }).format(nowInTz),
    );
    const minute =
      d.toDateString() === nowDateInTz.toDateString() &&
      selectedHour === nowHourInTz
        ? Math.floor(nowInTz.getMinutes() / 15) * 15
        : 0;
    d.setHours(selectedHour, minute, 0, 0);
    return d.toISOString();
  }, [selectedDate, selectedHour, calorieSummary.timezone]);
  const logDate = useMemo(() => toIsoDate(selectedDate), [selectedDate]);

  const loadFoods = useCallback(async () => {
    setIsLoadingFoods(true);
    setFoodError(null);
    try {
      const response = await fetch("/api/foods", { cache: "no-store" });
      const body = userCustomFoodsResponseSchema.parse(
        await readJsonResponse(response),
      );
      setFoods(body.items);
    } catch (error) {
      setFoodError(
        error instanceof Error ? error.message : "Could not load your foods",
      );
    } finally {
      setIsLoadingFoods(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("macros-add-food-scroll-lock");
    const storedFoods = readPendingFoods();
    if (storedFoods.length > 0) {
      setPendingFoods(storedFoods);
    }
    const unsubscribe = subscribeToPendingFoods(setPendingFoods);

    return () => {
      unsubscribe();
      document.documentElement.classList.remove("macros-add-food-scroll-lock");
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = containerRef.current;
    if (!vv || !el) return;

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

  useEffect(() => {
    void loadFoods();
  }, [loadFoods]);

  // A food just created elsewhere arrives with its id in the URL so the row it
  // became can announce itself, rather than a message saying it exists.
  useEffect(() => {
    if (!createdFoodId) return;
    if (!foods.some((food) => food.id === createdFoodId)) return;
    flash(createdFoodId);
    router.replace("/app/foods");
  }, [createdFoodId, flash, foods, router]);

  const pendingCalories = useMemo(
    () =>
      pendingFoods
        .filter((food) => food.input.logDate === calorieSummary.today)
        .reduce((sum, food) => sum + getPendingCalories(food), 0),
    [pendingFoods, calorieSummary.today],
  );

  const filteredFoods = useMemo(
    () => foods.filter((food) => matchesFood(food, query)),
    [foods, query],
  );

  const openCreateFood = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    router.push("/app/foods/new");
  }, [router]);

  const quickAddToPending = useCallback(
    (item: FoodSearchItem, servingsConsumed: number) => {
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
    },
    [eatenAt, logDate, selectedHour],
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

  const removePending = useCallback((uid: string) => {
    setPendingFoods((prev) => {
      const next = prev.filter((food) => food.uid !== uid);
      window.queueMicrotask(() => writePendingFoods(next));
      return next;
    });
  }, []);

  const deleteFood = useCallback(
    async (item: FoodSearchItem) => {
      setDeletingId(item.id);
      try {
        const response = await fetch(`/api/foods/${item.id}`, {
          method: "DELETE",
        });
        await readJsonResponse(response);
        setFoods((current) => current.filter((food) => food.id !== item.id));
        setFoodPendingDelete(null);
      } catch (error) {
        showError(error, "Could not delete food");
      } finally {
        setDeletingId(null);
      }
    },
    [showError],
  );

  const { isCommitting, logAllPending } = useLogPendingFoods({
    pendingFoods,
    setPendingFoods,
    setPendingSheetOpen,
    setExtraConsumed,
    today: calorieSummary.today,
    onFailures: (failedCount, retry) =>
      show({
        tone: "error",
        message: `${failedCount} ${failedCount === 1 ? "food" : "foods"} not logged`,
        action: { label: "Retry", onAction: retry },
      }),
  });

  return (
    <div
      ref={containerRef}
      className="macros-fixed-inset-x fixed top-0 z-50 flex flex-col overflow-hidden bg-background"
    >
      <div className="flex-none bg-background">
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
        <InlineNotice notice={notice} onDismiss={clearNotice} />
      </div>

      <div className="flex-none border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setQuery(event.target.value)
              }
              placeholder="Search your foods"
              className="h-11 rounded-full bg-muted pl-9 pr-3 text-base"
              enterKeyHint="search"
              autoComplete="off"
              inputMode="search"
            />
          </div>
          <Button
            type="button"
            onClick={openCreateFood}
            className="size-11 shrink-0 rounded-full bg-foreground p-0 text-background hover:bg-foreground/90"
            aria-label="Create food"
          >
            <Plus className="size-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-24">
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <h1 className="text-[11px] font-semibold tracking-[0.09em] uppercase text-muted-foreground">
            Your foods
          </h1>
          <span className="h-px flex-1 bg-border/60" aria-hidden="true" />
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {filteredFoods.length} / {foods.length}
          </span>
        </div>

        {foodError ? (
          <div className="px-4 py-3">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {foodError}
            </div>
          </div>
        ) : null}

        {isLoadingFoods ? (
          <div>
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 border-b border-border/30 px-4 py-3"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-10/12 animate-pulse rounded-full bg-muted/25" />
                  <div className="h-3 w-7/12 animate-pulse rounded-full bg-muted/20" />
                </div>
                <div className="h-8 w-14 shrink-0 animate-pulse rounded-full bg-muted/20" />
                <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted/20" />
              </div>
            ))}
          </div>
        ) : (
          filteredFoods.map((item) => (
            <FoodRow
              key={item.id}
              item={item}
              onSelect={setSelectedFood}
              onQuickAdd={quickAddToPending}
              onEdit={setEditingFood}
              onDelete={setFoodPendingDelete}
              deleting={deletingId === item.id}
              flashProps={flashProps}
            />
          ))
        )}

        {!isLoadingFoods && !foodError && filteredFoods.length === 0 ? (
          <p className="px-4 py-10 text-3xl leading-none font-light text-muted-foreground">
            —
          </p>
        ) : null}
      </div>

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 border-t border-border bg-background px-3 pt-3 pb-safe-end",
          pendingFoods.length === 0 && "hidden",
        )}
      >
        <Button
          type="button"
          disabled={pendingFoods.length === 0 || isCommitting}
          onClick={logAllPending}
          className="h-11 w-full rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
        >
          {isCommitting ? "Logging..." : `Log Foods (${pendingFoods.length})`}
        </Button>
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

      <EditFoodDrawer
        food={editingFood}
        onClose={() => setEditingFood(null)}
        onSaved={(previousId, item, fetchedAt) => {
          void putUserCreatedFood(item, fetchedAt);
          setFoods((current) =>
            current.map((food) => (food.id === previousId ? item : food)),
          );
          flash(item.id);
        }}
      />

      <PendingFoodsSheet
        open={pendingSheetOpen}
        onClose={() => setPendingSheetOpen(false)}
        pendingFoods={pendingFoods}
        onRemove={removePending}
        onCommit={logAllPending}
        isLogging={isCommitting}
      />

      <AlertDialog
        open={foodPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && deletingId === null) {
            setFoodPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete food?</AlertDialogTitle>
            <AlertDialogDescription>
              {foodPendingDelete
                ? `This removes ${
                    foodPendingDelete.brand
                      ? `${foodPendingDelete.name} by ${foodPendingDelete.brand}`
                      : foodPendingDelete.name
                  } from your foods. Existing logs will not change.`
                : "This food will be removed from your foods."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingId !== null || foodPendingDelete === null}
              onClick={(event) => {
                event.preventDefault();
                if (foodPendingDelete) {
                  void deleteFood(foodPendingDelete);
                }
              }}
            >
              {deletingId !== null ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function FoodsPageClient() {
  const hydrated = useHydrated();
  const { data, error, isError, refetch } = useDailyCalorieSummary();

  if (!hydrated) {
    return <FoodsFallback />;
  }

  if (isError && !data) {
    return (
      <div className="flex h-dvh flex-col px-4 pt-4">
        <Alert variant="destructive">
          <AlertTitle>Could not load today&apos;s summary</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Refresh your nutrition snapshot and try again."}
          </AlertDescription>
          <div className="mt-3">
            <Button type="button" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  if (!data) {
    return <FoodsFallback />;
  }

  return <FoodsLogic calorieSummary={data} />;
}
