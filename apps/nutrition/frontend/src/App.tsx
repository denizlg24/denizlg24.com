import {
  Barcode,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

type SearchMode = "text" | "brand" | "barcode";
type Language = "english" | "portuguese" | "spanish" | "french";

interface ApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
}

interface ApiFailure {
  success: false;
  error: { code: string; message: string };
  requestId: string;
}

interface ItemSummary {
  id: string;
  barcode: string;
  name: string;
  brand: string | null;
  servingLabel: string | null;
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
}

interface ItemSearchResult extends ItemSummary {
  rank?: number;
  score?: number;
}

interface NutritionData {
  itemId: string;
  servingLabel: string;
  servingQnty: number;
  servingUnit: string;
  calories: number | null;
  water: number | null;
  alcohol: number | null;
  caffeine: number | null;
  cholesterol: number | null;
  choline: number | null;
  carbs: number | null;
  fiber: number | null;
  sugar: number | null;
  addedSugar: number | null;
  polyols: number | null;
  fat: number | null;
  monoUnsaturated: number | null;
  polyUnsaturated: number | null;
  omega3: number | null;
  omega3Ala: number | null;
  omega3Dha: number | null;
  omega3Epa: number | null;
  omega6: number | null;
  saturated: number | null;
  transFat: number | null;
  protein: number | null;
  cysteine: number | null;
  histidine: number | null;
  isoleucine: number | null;
  leucine: number | null;
  lysine: number | null;
  methionine: number | null;
  phenylalanine: number | null;
  threonine: number | null;
  tryptophan: number | null;
  tyrosine: number | null;
  valine: number | null;
  a: number | null;
  b1: number | null;
  b2: number | null;
  b3: number | null;
  b5: number | null;
  b6: number | null;
  b12: number | null;
  c: number | null;
  d: number | null;
  e: number | null;
  k: number | null;
  folate: number | null;
  calcium: number | null;
  copper: number | null;
  iron: number | null;
  magnesium: number | null;
  manganese: number | null;
  phosphorus: number | null;
  potassium: number | null;
  selenium: number | null;
  sodium: number | null;
  zinc: number | null;
}

type NutritionState = NutritionData | "loading" | "error";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

const languages = [
  { value: "english", label: "EN" },
  { value: "portuguese", label: "PT" },
  { value: "spanish", label: "ES" },
  { value: "french", label: "FR" },
] as const satisfies readonly { value: Language; label: string }[];

const fmt = (v: number | null | undefined, unit: string) =>
  v == null
    ? "—"
    : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;

const readNum = (v: string) => {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const getApiPath = (path: string) =>
  `${apiBaseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

const fetchApi = async <T,>(path: string): Promise<T> => {
  const response = await fetch(getApiPath(path));
  const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!response.ok || !payload.success) {
    throw new Error(
      payload.success
        ? "Request failed"
        : (payload as ApiFailure).error.message,
    );
  }
  return payload.data;
};

function NutrientRow({
  label,
  value,
  unit,
  indent = false,
  bold = false,
  max,
}: {
  label: string;
  value: number | null;
  unit: string;
  indent?: boolean;
  bold?: boolean;
  max?: number;
}) {
  const pct =
    max != null && value != null ? Math.min(100, (value / max) * 100) : null;
  return (
    <div
      className={[
        "grid grid-cols-[1fr_auto] items-center gap-x-3 text-[11px]",
        indent
          ? "pl-7 pr-3.5 py-0.5"
          : bold
            ? "px-3.5 pt-2 pb-0.5"
            : "px-3.5 py-0.5",
      ].join(" ")}
    >
      <span
        className={`whitespace-nowrap ${bold ? "font-medium text-ni-text" : "text-ni-muted"}`}
      >
        {label}
      </span>
      <span className="font-medium text-right whitespace-nowrap tabular-nums min-w-[52px] text-ni-text font-mono">
        {fmt(value, unit)}
      </span>
      {pct !== null && (
        <div className="col-span-2 h-px bg-ni-border rounded-full overflow-hidden mt-1 mb-0.5">
          <div
            className="h-full bg-ni-accent rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function NutritionSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-ni-border">
      <p className="text-[8px] tracking-[0.12em] uppercase text-ni-muted px-3.5 pt-1.5 pb-0.5">
        {title}
      </p>
      {children}
    </div>
  );
}

function NutritionPanel({
  item,
  nutrition,
}: {
  item: ItemSearchResult;
  nutrition: NutritionState;
}) {
  if (nutrition === "loading") {
    return (
      <div className="px-2.5 pb-5 animate-slide-down">
        <div className="border-2 border-ni-text max-w-[380px] bg-white font-mono mx-auto">
          <div className="bg-ni-text text-ni-bg px-3.5 pt-2.5 pb-2 flex justify-between items-baseline gap-3">
            <span className="font-display text-xl font-semibold tracking-tight leading-none shrink-0">
              Nutrition Facts
            </span>
            <span className="text-[9px] opacity-65 tracking-wide text-right">
              {item.servingLabel ?? "per serving"}
            </span>
          </div>
          <div className="flex items-center gap-2 px-3.5 py-4 text-[11px] text-ni-muted">
            <Loader2 size={14} className="animate-spin shrink-0" />
            Loading nutrition data…
          </div>
        </div>
      </div>
    );
  }

  if (nutrition === "error") {
    return (
      <div className="px-2.5 pb-5 animate-slide-down">
        <div className="border-2 border-ni-text max-w-[380px] bg-white font-mono mx-auto">
          <div className="bg-ni-text text-ni-bg px-3.5 pt-2.5 pb-2">
            <span className="font-display text-xl font-semibold tracking-tight leading-none">
              Nutrition Facts
            </span>
          </div>
          <p className="px-3.5 py-3.5 text-[11px] text-ni-accent">
            Failed to load nutrition data
          </p>
        </div>
      </div>
    );
  }

  const n = nutrition;

  const hasAminoAcids = [
    n.cysteine,
    n.histidine,
    n.isoleucine,
    n.leucine,
    n.lysine,
    n.methionine,
    n.phenylalanine,
    n.threonine,
    n.tryptophan,
    n.tyrosine,
    n.valine,
  ].some((v) => v != null && v > 0);

  const hasVitamins = [
    n.a,
    n.b1,
    n.b2,
    n.b3,
    n.b5,
    n.b6,
    n.b12,
    n.c,
    n.d,
    n.e,
    n.k,
    n.folate,
  ].some((v) => v != null && v > 0);

  const hasMinerals = [
    n.calcium,
    n.copper,
    n.iron,
    n.magnesium,
    n.manganese,
    n.phosphorus,
    n.potassium,
    n.selenium,
    n.sodium,
    n.zinc,
  ].some((v) => v != null && v > 0);

  return (
    <div className="px-2.5 pb-5 animate-slide-down">
      <div className="border-2 border-ni-text max-w-[380px] bg-white font-mono mx-auto">
        {/* Header */}
        <div className="bg-ni-text text-ni-bg px-3.5 pt-2.5 pb-2 flex justify-between items-baseline gap-3">
          <span className="font-display text-xl font-semibold tracking-tight leading-none shrink-0">
            Nutrition Facts
          </span>
          <span className="text-[9px] opacity-65 tracking-wide text-right">
            {n.servingQnty} {n.servingUnit} · {n.servingLabel}
          </span>
        </div>

        {/* Calories */}
        <div className="flex justify-between items-baseline px-3.5 py-2.5 border-b-[6px] border-ni-text">
          <span className="text-[13px] font-medium tracking-wide text-ni-text">
            Calories
          </span>
          <span className="text-[32px] font-medium leading-none tracking-tight tabular-nums text-ni-text">
            {n.calories ?? "—"}
          </span>
        </div>

        {/* Macronutrients */}
        <NutritionSection title="Macronutrients">
          <NutrientRow label="Total Fat" value={n.fat} unit="g" bold max={65} />
          <NutrientRow
            label="Saturated Fat"
            value={n.saturated}
            unit="g"
            indent
          />
          <NutrientRow label="Trans Fat" value={n.transFat} unit="g" indent />
          <NutrientRow
            label="Mono-unsaturated"
            value={n.monoUnsaturated}
            unit="g"
            indent
          />
          <NutrientRow
            label="Poly-unsaturated"
            value={n.polyUnsaturated}
            unit="g"
            indent
          />
          <NutrientRow label="Omega-3" value={n.omega3} unit="g" indent />
          <NutrientRow label="Omega-6" value={n.omega6} unit="g" indent />
          <NutrientRow
            label="Total Carbs"
            value={n.carbs}
            unit="g"
            bold
            max={300}
          />
          <NutrientRow label="Dietary Fiber" value={n.fiber} unit="g" indent />
          <NutrientRow label="Total Sugars" value={n.sugar} unit="g" indent />
          <NutrientRow
            label="Added Sugars"
            value={n.addedSugar}
            unit="g"
            indent
          />
          <NutrientRow
            label="Protein"
            value={n.protein}
            unit="g"
            bold
            max={50}
          />
        </NutritionSection>

        {/* Other */}
        <NutritionSection title="Other">
          <NutrientRow label="Cholesterol" value={n.cholesterol} unit="mg" />
          <NutrientRow label="Sodium" value={n.sodium} unit="mg" />
          {(n.water ?? 0) > 0 && (
            <NutrientRow label="Water" value={n.water} unit="g" />
          )}
          {(n.caffeine ?? 0) > 0 && (
            <NutrientRow label="Caffeine" value={n.caffeine} unit="mg" />
          )}
          {(n.alcohol ?? 0) > 0 && (
            <NutrientRow label="Alcohol" value={n.alcohol} unit="g" />
          )}
          {(n.choline ?? 0) > 0 && (
            <NutrientRow label="Choline" value={n.choline} unit="mg" />
          )}
        </NutritionSection>

        {hasVitamins && (
          <NutritionSection title="Vitamins">
            {(n.a ?? 0) > 0 && (
              <NutrientRow label="Vitamin A" value={n.a} unit="µg" />
            )}
            {(n.c ?? 0) > 0 && (
              <NutrientRow label="Vitamin C" value={n.c} unit="mg" />
            )}
            {(n.d ?? 0) > 0 && (
              <NutrientRow label="Vitamin D" value={n.d} unit="µg" />
            )}
            {(n.e ?? 0) > 0 && (
              <NutrientRow label="Vitamin E" value={n.e} unit="mg" />
            )}
            {(n.k ?? 0) > 0 && (
              <NutrientRow label="Vitamin K" value={n.k} unit="µg" />
            )}
            {(n.b1 ?? 0) > 0 && (
              <NutrientRow label="Thiamine (B1)" value={n.b1} unit="mg" />
            )}
            {(n.b2 ?? 0) > 0 && (
              <NutrientRow label="Riboflavin (B2)" value={n.b2} unit="mg" />
            )}
            {(n.b3 ?? 0) > 0 && (
              <NutrientRow label="Niacin (B3)" value={n.b3} unit="mg" />
            )}
            {(n.b5 ?? 0) > 0 && (
              <NutrientRow
                label="Pantothenic Acid (B5)"
                value={n.b5}
                unit="mg"
              />
            )}
            {(n.b6 ?? 0) > 0 && (
              <NutrientRow label="Vitamin B6" value={n.b6} unit="mg" />
            )}
            {(n.b12 ?? 0) > 0 && (
              <NutrientRow label="Vitamin B12" value={n.b12} unit="µg" />
            )}
            {(n.folate ?? 0) > 0 && (
              <NutrientRow label="Folate" value={n.folate} unit="µg" />
            )}
          </NutritionSection>
        )}

        {hasMinerals && (
          <NutritionSection title="Minerals">
            {(n.calcium ?? 0) > 0 && (
              <NutrientRow label="Calcium" value={n.calcium} unit="mg" />
            )}
            {(n.iron ?? 0) > 0 && (
              <NutrientRow label="Iron" value={n.iron} unit="mg" />
            )}
            {(n.magnesium ?? 0) > 0 && (
              <NutrientRow label="Magnesium" value={n.magnesium} unit="mg" />
            )}
            {(n.phosphorus ?? 0) > 0 && (
              <NutrientRow label="Phosphorus" value={n.phosphorus} unit="mg" />
            )}
            {(n.potassium ?? 0) > 0 && (
              <NutrientRow label="Potassium" value={n.potassium} unit="mg" />
            )}
            {(n.zinc ?? 0) > 0 && (
              <NutrientRow label="Zinc" value={n.zinc} unit="mg" />
            )}
            {(n.copper ?? 0) > 0 && (
              <NutrientRow label="Copper" value={n.copper} unit="mg" />
            )}
            {(n.manganese ?? 0) > 0 && (
              <NutrientRow label="Manganese" value={n.manganese} unit="mg" />
            )}
            {(n.selenium ?? 0) > 0 && (
              <NutrientRow label="Selenium" value={n.selenium} unit="µg" />
            )}
          </NutritionSection>
        )}

        {hasAminoAcids && (
          <NutritionSection title="Amino Acids">
            {(n.leucine ?? 0) > 0 && (
              <NutrientRow label="Leucine" value={n.leucine} unit="g" />
            )}
            {(n.isoleucine ?? 0) > 0 && (
              <NutrientRow label="Isoleucine" value={n.isoleucine} unit="g" />
            )}
            {(n.valine ?? 0) > 0 && (
              <NutrientRow label="Valine" value={n.valine} unit="g" />
            )}
            {(n.lysine ?? 0) > 0 && (
              <NutrientRow label="Lysine" value={n.lysine} unit="g" />
            )}
            {(n.methionine ?? 0) > 0 && (
              <NutrientRow label="Methionine" value={n.methionine} unit="g" />
            )}
            {(n.phenylalanine ?? 0) > 0 && (
              <NutrientRow
                label="Phenylalanine"
                value={n.phenylalanine}
                unit="g"
              />
            )}
            {(n.threonine ?? 0) > 0 && (
              <NutrientRow label="Threonine" value={n.threonine} unit="g" />
            )}
            {(n.tryptophan ?? 0) > 0 && (
              <NutrientRow label="Tryptophan" value={n.tryptophan} unit="g" />
            )}
            {(n.histidine ?? 0) > 0 && (
              <NutrientRow label="Histidine" value={n.histidine} unit="g" />
            )}
            {(n.cysteine ?? 0) > 0 && (
              <NutrientRow label="Cysteine" value={n.cysteine} unit="g" />
            )}
            {(n.tyrosine ?? 0) > 0 && (
              <NutrientRow label="Tyrosine" value={n.tyrosine} unit="g" />
            )}
          </NutritionSection>
        )}

        {/* Footer */}
        <div className="border-t border-ni-border px-3.5 py-2 flex justify-between text-[10px] text-ni-muted">
          <span>{item.brand ?? "Unbranded"}</span>
          <span className="tracking-[0.1em] font-mono">{item.barcode}</span>
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 12;

function App() {
  const [mode, setMode] = useState<SearchMode>("text");
  const [query, setQuery] = useState("");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [brandValue, setBrandValue] = useState("");
  const [language, setLanguage] = useState<Language>("english");
  const [minScore, setMinScore] = useState("0.1");
  const [maxCalories, setMaxCalories] = useState("");
  const [minProtein, setMinProtein] = useState("");
  const [maxFat, setMaxFat] = useState("");
  const [maxCarbs, setMaxCarbs] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ItemSearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nutritionCache, setNutritionCache] = useState<
    Record<string, NutritionState>
  >({});
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filteredItems = useMemo(() => {
    const calMax = readNum(maxCalories);
    const protMin = readNum(minProtein);
    const fatMax = readNum(maxFat);
    const carbMax = readNum(maxCarbs);
    return items.filter((item) => {
      if (calMax !== undefined && (item.caloriesPerServing ?? 0) > calMax)
        return false;
      if (protMin !== undefined && (item.proteinPerServing ?? 0) < protMin)
        return false;
      if (fatMax !== undefined && (item.fatPerServing ?? 0) > fatMax)
        return false;
      if (carbMax !== undefined && (item.carbsPerServing ?? 0) > carbMax)
        return false;
      return true;
    });
  }, [items, maxCalories, minProtein, maxFat, maxCarbs]);

  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleItems = filteredItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const handleSearch = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");
    setPage(1);
    setSelectedId(null);
    try {
      if (mode === "barcode") {
        const item = await fetchApi<ItemSummary>(
          `/items/barcode/${encodeURIComponent(barcodeValue.trim())}`,
        );
        setItems([{ ...item, score: 1 }]);
      } else {
        const params = new URLSearchParams({ limit: "100", minScore });
        if (mode === "text") {
          params.set("q", query.trim());
          params.set("lang", language);
        } else {
          params.set("brand", brandValue.trim());
        }
        const results = await fetchApi<ItemSearchResult[]>(
          `/items/search?${params}`,
        );
        setItems(results);
      }
      setStatus("ready");
    } catch (error) {
      setItems([]);
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Request failed",
      );
    }
  };

  const toggleSelected = async (item: ItemSearchResult) => {
    if (selectedId === item.id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(item.id);
    if (nutritionCache[item.id]) return;

    setNutritionCache((prev) => ({ ...prev, [item.id]: "loading" }));
    try {
      const data = await fetchApi<NutritionData>(`/items/${item.id}/nutrition`);
      setNutritionCache((prev) => ({ ...prev, [item.id]: data }));
    } catch {
      setNutritionCache((prev) => ({ ...prev, [item.id]: "error" }));
    }
  };

  const currentInput =
    mode === "text" ? query : mode === "brand" ? brandValue : barcodeValue;
  const hasFilters = Boolean(maxCalories || minProtein || maxFat || maxCarbs);

  const modeBtnClass = (active: boolean) =>
    [
      "flex items-center gap-1.5 border-none cursor-pointer px-2 py-1 text-[12px] font-[inherit] tracking-wide rounded transition-colors bg-transparent",
      active ? "text-ni-text font-medium" : "text-ni-muted hover:text-ni-text",
    ].join(" ");

  return (
    <div className="min-h-screen max-w-[880px] mx-auto px-4 sm:px-7">
      {/* ── Header ── */}
      <header className="border-b border-ni-border pt-8 pb-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="font-display text-[26px] font-normal tracking-tight leading-none text-ni-text m-0">
              deniz's nutrition<span className="text-ni-accent">.</span>api
            </h1>
            <p className="text-[10px] text-ni-muted mt-1.5 tracking-[0.08em] uppercase m-0">
              Food &amp; nutrient database
            </p>
          </div>
          <div className="flex items-center gap-0.5 text-xs">
            <button
              type="button"
              className={modeBtnClass(mode === "text")}
              onClick={() => setMode("text")}
            >
              <Search size={14} /> Text
            </button>
            <span className="text-ni-border select-none px-0.5">·</span>
            <button
              type="button"
              className={modeBtnClass(mode === "brand")}
              onClick={() => setMode("brand")}
            >
              <Tag size={14} /> Brand
            </button>
            <span className="text-ni-border select-none px-0.5">·</span>
            <button
              type="button"
              className={modeBtnClass(mode === "barcode")}
              onClick={() => setMode("barcode")}
            >
              <Barcode size={14} /> Barcode
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="py-9">
        {/* Search form */}
        <form className="mb-9" onSubmit={handleSearch}>
          <div className="flex items-center gap-2.5 border-b-2 border-ni-text pb-2.5">
            <input
              className="flex-1 border-none bg-transparent font-display text-2xl font-normal text-ni-text outline-none tracking-tight placeholder:text-ni-border placeholder:italic"
              placeholder={
                mode === "text"
                  ? "Search for a food…"
                  : mode === "brand"
                    ? "Search by brand…"
                    : "Enter barcode…"
              }
              value={currentInput}
              onChange={(e) => {
                if (mode === "text") setQuery(e.target.value);
                else if (mode === "brand") setBrandValue(e.target.value);
                else setBarcodeValue(e.target.value);
              }}
              minLength={1}
              required
              autoComplete="off"
              // biome-ignore lint/a11y/noAutofocus: the search box is the page's only control
              autoFocus
            />
            <div className="flex items-center gap-2 shrink-0">
              {mode === "text" && (
                <div className="hidden sm:flex gap-px">
                  {languages.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      onClick={() => setLanguage(l.value)}
                      className={[
                        "border-none cursor-pointer text-[11px] font-mono px-1.5 py-1 rounded-sm transition-all",
                        language === l.value
                          ? "text-ni-text bg-ni-surface font-medium"
                          : "text-ni-muted bg-transparent hover:text-ni-text",
                      ].join(" ")}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
              {mode !== "barcode" && (
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  title="Filters"
                  className={[
                    "flex items-center justify-center border rounded-sm cursor-pointer p-1.5 transition-all",
                    hasFilters
                      ? "text-ni-accent border-ni-accent"
                      : filtersOpen
                        ? "text-ni-text border-ni-text"
                        : "text-ni-muted border-ni-border hover:text-ni-text hover:border-ni-text",
                  ].join(" ")}
                >
                  <SlidersHorizontal size={14} />
                </button>
              )}
              <button
                type="submit"
                disabled={status === "loading"}
                className="flex items-center justify-center bg-ni-text border-none rounded-sm cursor-pointer px-4 py-2 text-ni-bg transition-opacity hover:opacity-80 disabled:opacity-35 disabled:cursor-not-allowed"
              >
                {status === "loading" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Search size={15} />
                )}
              </button>
            </div>
          </div>

          {/* Mobile language selector */}
          {mode === "text" && (
            <div className="flex sm:hidden gap-px pt-3">
              {languages.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLanguage(l.value)}
                  className={[
                    "border-none cursor-pointer text-[11px] font-mono px-1.5 py-1 rounded-sm transition-all",
                    language === l.value
                      ? "text-ni-text bg-ni-surface font-medium"
                      : "text-ni-muted bg-transparent hover:text-ni-text",
                  ].join(" ")}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}

          {/* Filters row */}
          {filtersOpen && mode !== "barcode" && (
            <div className="pt-5 animate-fade-in">
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-4 sm:gap-5 items-end">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="cal-filter"
                    className="text-[9px] tracking-[0.1em] uppercase text-ni-muted"
                  >
                    Max kcal
                  </label>
                  <input
                    id="cal-filter"
                    type="number"
                    min="0"
                    placeholder="—"
                    value={maxCalories}
                    onChange={(e) => {
                      setMaxCalories(e.target.value);
                      setPage(1);
                    }}
                    className="bg-transparent border-0 border-b border-ni-border pb-1 text-[13px] text-ni-text outline-none w-full sm:w-[110px] transition-colors focus:border-ni-text placeholder:text-ni-border"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="prot-filter"
                    className="text-[9px] tracking-[0.1em] uppercase text-ni-muted"
                  >
                    Min protein (g)
                  </label>
                  <input
                    id="prot-filter"
                    type="number"
                    min="0"
                    placeholder="—"
                    value={minProtein}
                    onChange={(e) => {
                      setMinProtein(e.target.value);
                      setPage(1);
                    }}
                    className="bg-transparent border-0 border-b border-ni-border pb-1 text-[13px] text-ni-text outline-none w-full sm:w-[110px] transition-colors focus:border-ni-text placeholder:text-ni-border"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="fat-filter"
                    className="text-[9px] tracking-[0.1em] uppercase text-ni-muted"
                  >
                    Max fat (g)
                  </label>
                  <input
                    id="fat-filter"
                    type="number"
                    min="0"
                    placeholder="—"
                    value={maxFat}
                    onChange={(e) => {
                      setMaxFat(e.target.value);
                      setPage(1);
                    }}
                    className="bg-transparent border-0 border-b border-ni-border pb-1 text-[13px] text-ni-text outline-none w-full sm:w-[110px] transition-colors focus:border-ni-text placeholder:text-ni-border"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="carb-filter"
                    className="text-[9px] tracking-[0.1em] uppercase text-ni-muted"
                  >
                    Max carbs (g)
                  </label>
                  <input
                    id="carb-filter"
                    type="number"
                    min="0"
                    placeholder="—"
                    value={maxCarbs}
                    onChange={(e) => {
                      setMaxCarbs(e.target.value);
                      setPage(1);
                    }}
                    className="bg-transparent border-0 border-b border-ni-border pb-1 text-[13px] text-ni-text outline-none w-full sm:w-[110px] transition-colors focus:border-ni-text placeholder:text-ni-border"
                  />
                </div>
                {mode === "text" && (
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="score-filter"
                      className="text-[9px] tracking-[0.1em] uppercase text-ni-muted"
                    >
                      Min score
                    </label>
                    <input
                      id="score-filter"
                      type="number"
                      min="0"
                      step="0.05"
                      placeholder="0.1"
                      value={minScore}
                      onChange={(e) => setMinScore(e.target.value)}
                      className="bg-transparent border-0 border-b border-ni-border pb-1 text-[13px] text-ni-text outline-none w-full sm:w-[110px] transition-colors focus:border-ni-text placeholder:text-ni-border"
                    />
                  </div>
                )}
                {hasFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setMaxCalories("");
                      setMinProtein("");
                      setMaxFat("");
                      setMaxCarbs("");
                      setPage(1);
                    }}
                    className="flex items-center gap-1 bg-transparent border-none cursor-pointer text-[11px] text-ni-muted pb-1 transition-colors hover:text-ni-accent self-end"
                  >
                    <X size={11} /> Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </form>

        {/* Results */}
        <div>
          {status === "loading" && (
            <div className="flex flex-col">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[53px] border-b border-ni-border animate-shimmer"
                  style={{ animationDelay: `${i * 50}ms` }}
                />
              ))}
            </div>
          )}

          {status === "error" && (
            <div className="flex gap-3 items-baseline pt-5 border-t border-ni-border">
              <span className="text-[9px] tracking-[0.1em] uppercase text-ni-accent font-mono shrink-0">
                Error
              </span>
              <span className="text-sm">{errorMessage}</span>
            </div>
          )}

          {status === "idle" && (
            <p className="py-16 text-center text-[15px] text-ni-muted italic font-display">
              Enter a search term to begin
            </p>
          )}

          {status === "ready" && visibleItems.length === 0 && (
            <p className="py-16 text-center text-[15px] text-ni-muted italic font-display">
              No matching items
            </p>
          )}

          {status === "ready" && visibleItems.length > 0 && (
            <>
              {/* Meta bar */}
              <div className="flex justify-between items-center text-[10px] text-ni-muted tracking-[0.07em] uppercase pb-3 border-b border-ni-border">
                <span>{filteredItems.length.toLocaleString()} items</span>
                <span className="font-mono tracking-[0.04em]">
                  {currentPage} / {pageCount}
                </span>
              </div>

              {/* List */}
              <ul className="list-none m-0 p-0">
                {visibleItems.map((item) => {
                  const expanded = selectedId === item.id;
                  return (
                    <li
                      key={item.id}
                      className={`border-b border-ni-border transition-colors ${expanded ? "bg-ni-surface" : "hover:bg-ni-surface"}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSelected(item)}
                        className="flex items-center gap-4 w-full bg-transparent border-none cursor-pointer px-2.5 py-3.5 text-left text-ni-text"
                      >
                        {/* Name + brand */}
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="text-[14px] font-medium truncate tracking-tight">
                            {item.name}
                          </span>
                          <span className="text-[11px] text-ni-muted truncate">
                            {item.brand ?? "—"}
                          </span>
                        </div>

                        {/* Macro chips — fixed 4-column grid for consistent alignment */}
                        <div className="hidden sm:grid grid-cols-[82px_58px_58px_50px] gap-1.5 shrink-0 font-mono text-[11px] tabular-nums">
                          <span className="bg-ni-text text-ni-bg px-1.5 py-0.5 rounded-sm text-center">
                            {fmt(item.caloriesPerServing, " kcal")}
                          </span>
                          <span className="text-ni-accent text-right py-0.5">
                            P&nbsp;{fmt(item.proteinPerServing, "g")}
                          </span>
                          <span className="text-ni-muted text-right py-0.5">
                            C&nbsp;{fmt(item.carbsPerServing, "g")}
                          </span>
                          <span className="text-ni-muted text-right py-0.5">
                            F&nbsp;{fmt(item.fatPerServing, "g")}
                          </span>
                        </div>

                        {/* Chevron */}
                        <span
                          className={`shrink-0 transition-colors ${expanded ? "text-ni-accent" : "text-ni-muted"}`}
                        >
                          {expanded ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </span>
                      </button>

                      {expanded && (
                        <NutritionPanel
                          item={item}
                          nutrition={nutritionCache[item.id] ?? "loading"}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Pagination */}
              <div className="flex items-center justify-center gap-5 py-7">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setPage((v) => Math.max(1, v - 1))}
                  className="flex items-center border border-ni-border rounded-sm cursor-pointer px-2 py-1.5 text-ni-text bg-transparent transition-colors hover:border-ni-text disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="font-mono text-[12px] text-ni-muted tracking-[0.04em]">
                  {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  disabled={currentPage === pageCount}
                  onClick={() => setPage((v) => Math.min(pageCount, v + 1))}
                  className="flex items-center border border-ni-border rounded-sm cursor-pointer px-2 py-1.5 text-ni-text bg-transparent transition-colors hover:border-ni-text disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
