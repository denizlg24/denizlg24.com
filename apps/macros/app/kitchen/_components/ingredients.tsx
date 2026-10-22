import { formatFoodQuantity } from "@repo/macros-core/foods/display";
import {
  buildServingOptions,
  findOption,
  foodServingFrom,
  quantityFor,
  type ServingOptions,
  servingsFor,
} from "@repo/macros-core/foods/serving-options";
import {
  type MacrosFoodSearchItem,
  macrosFoodDetailResponseSchema,
  macrosFoodSearchResponseSchema,
} from "@repo/schemas/macros";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./kitchen.module.css";

export type Macros = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type DraftIngredient = {
  key: string;
  /** Set for rows already saved; they keep the nutrition they were saved with. */
  ingredientId?: string;
  sourceItemId: string | null;
  name: string;
  brand: string | null;
  /** What the recipe calls it; empty shows the food's own name. */
  displayName: string;
  iconKey: string | null;
  servings: number;
  perServing: Macros;
  amountLabel: string;
};

let sequence = 0;
export function nextKey() {
  sequence += 1;
  return `ingredient-${sequence}`;
}

export function fromSearchItem(item: MacrosFoodSearchItem): DraftIngredient {
  return {
    key: nextKey(),
    sourceItemId: item.id,
    name: item.name,
    brand: item.brand,
    displayName: "",
    iconKey: item.iconKey,
    servings: 1,
    perServing: {
      calories: item.caloriesPerServing ?? 0,
      protein: item.proteinPerServing ?? 0,
      carbs: item.carbsPerServing ?? 0,
      fat: item.fatPerServing ?? 0,
    },
    amountLabel: item.servingLabel ? `1 × ${item.servingLabel}` : "1 serving",
  };
}

export function totalsOf(ingredients: readonly DraftIngredient[]): Macros {
  return ingredients.reduce(
    (sum, { perServing, servings }) => ({
      calories: sum.calories + perServing.calories * servings,
      protein: sum.protein + perServing.protein * servings,
      carbs: sum.carbs + perServing.carbs * servings,
      fat: sum.fat + perServing.fat * servings,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

const servingCache = new Map<string, Promise<ServingOptions>>();

function servingOptionsFor(sourceItemId: string) {
  let pending = servingCache.get(sourceItemId);
  if (!pending) {
    pending = fetch(`/api/foods/${sourceItemId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Couldn’t load serving sizes.");
        const detail = macrosFoodDetailResponseSchema.parse(
          await response.json(),
        );
        return buildServingOptions(foodServingFrom(detail.nutrition));
      })
      .catch((error: unknown) => {
        servingCache.delete(sourceItemId);
        throw error;
      });
    servingCache.set(sourceItemId, pending);
  }
  return pending;
}

function parseQuantity(text: string) {
  const value = Number(text.replace(",", ".").trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function IngredientList({
  ingredients,
  onChange,
}: {
  ingredients: readonly DraftIngredient[];
  onChange: (next: DraftIngredient[]) => void;
}) {
  const update = (key: string, patch: Partial<DraftIngredient>) =>
    onChange(
      ingredients.map((ingredient) =>
        ingredient.key === key ? { ...ingredient, ...patch } : ingredient,
      ),
    );
  const move = (index: number, offset: -1 | 1) => {
    const next = [...ingredients];
    const [moving] = next.splice(index, 1);
    if (!moving) return;
    next.splice(index + offset, 0, moving);
    onChange(next);
  };

  return (
    <div>
      {ingredients.length ? (
        <ul className={styles.ingredientList}>
          {ingredients.map((ingredient, index) => (
            <li key={ingredient.key} className={styles.ingredientRow}>
              <div className={styles.ingredientName}>
                <input
                  className={styles.displayName}
                  value={ingredient.displayName}
                  placeholder={ingredient.name}
                  maxLength={120}
                  aria-label={`Name ${ingredient.name} in this recipe`}
                  onChange={(event) =>
                    update(ingredient.key, { displayName: event.target.value })
                  }
                />
                <small>
                  {ingredient.displayName.trim()
                    ? [ingredient.name, ingredient.brand]
                        .filter(Boolean)
                        .join(" · ")
                    : ingredient.brand}
                </small>
              </div>
              <AmountField
                ingredient={ingredient}
                onChange={(servings, amountLabel) =>
                  update(ingredient.key, { servings, amountLabel })
                }
              />
              <span className={styles.ingredientKcal}>
                {Math.round(
                  ingredient.perServing.calories * ingredient.servings,
                )}{" "}
                kcal
              </span>
              <div className={styles.rowTools}>
                <button
                  type="button"
                  aria-label={`Move ${ingredient.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${ingredient.name} down`}
                  disabled={index === ingredients.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${ingredient.name}`}
                  onClick={() =>
                    onChange(
                      ingredients.filter((row) => row.key !== ingredient.key),
                    )
                  }
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <FoodSearch
        onPick={(item) => onChange([...ingredients, fromSearchItem(item)])}
      />
    </div>
  );
}

function AmountField({
  ingredient,
  onChange,
}: {
  ingredient: DraftIngredient;
  onChange: (servings: number, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ServingOptions | null>(null);
  const [optionId, setOptionId] = useState("servings");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const popover = useRef<HTMLDivElement>(null);

  async function openEditor() {
    setOpen(true);
    setError(null);
    if (!ingredient.sourceItemId) {
      setOptions(null);
      setText(formatFoodQuantity(ingredient.servings));
      return;
    }
    try {
      const loaded = await servingOptionsFor(ingredient.sourceItemId);
      const option = findOption(loaded, loaded.defaultId);
      setOptions(loaded);
      setOptionId(option.id);
      setText(formatFoodQuantity(quantityFor(ingredient.servings, option)));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Couldn’t load sizes.",
      );
      setText(formatFoodQuantity(ingredient.servings));
    }
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !popover.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function apply() {
    const quantity = parseQuantity(text);
    if (quantity === null) {
      setError("Enter an amount above zero.");
      return;
    }
    if (options) {
      const option = findOption(options, optionId);
      const servings = servingsFor(quantity, option);
      if (servings > 9999) {
        setError("That amount is too large.");
        return;
      }
      onChange(servings, `${formatFoodQuantity(quantity)} ${option.unit}`);
    } else {
      onChange(
        quantity,
        `${formatFoodQuantity(quantity)} ${quantity === 1 ? "serving" : "servings"}`,
      );
    }
    setOpen(false);
  }

  return (
    <div className={styles.amount} ref={popover}>
      <button
        type="button"
        className={styles.amountButton}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : void openEditor())}
      >
        {ingredient.amountLabel}
      </button>
      {open ? (
        <form
          className={styles.amountPopover}
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by an explicit click
            autoFocus
            inputMode="decimal"
            aria-label="Amount"
            value={text}
            onChange={(event) => {
              setError(null);
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          />
          {options ? (
            <select
              aria-label="Unit"
              value={optionId}
              onChange={(event) => {
                const from = findOption(options, optionId);
                const to = findOption(options, event.target.value);
                const quantity = parseQuantity(text);
                if (quantity !== null)
                  setText(
                    formatFoodQuantity(
                      quantityFor(servingsFor(quantity, from), to),
                    ),
                  );
                setOptionId(to.id);
              }}
            >
              {options.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}
                </option>
              ))}
            </select>
          ) : (
            <span className={styles.unit}>servings</span>
          )}
          <button type="submit">Set</button>
          {error ? (
            <p className={styles.fieldError} role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function FoodSearch({
  onPick,
}: {
  onPick: (item: MacrosFoodSearchItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MacrosFoodSearchItem[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItems([]);
      setState("idle");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch(
          `/api/foods/search?${new URLSearchParams({ q, limit: "12" })}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("search failed");
        const parsed = macrosFoodSearchResponseSchema.parse(
          await response.json(),
        );
        setItems(parsed.items);
        setActive(0);
        setState("idle");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function pick(item: MacrosFoodSearchItem) {
    onPick(item);
    setQuery("");
    setItems([]);
  }

  const expanded = items.length > 0;
  return (
    <div className={styles.search}>
      <input
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        aria-label="Add an ingredient"
        placeholder="Add an ingredient…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (!expanded) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(items.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const item = items[active];
            if (item) pick(item);
          } else if (event.key === "Escape") {
            setItems([]);
          }
        }}
      />
      {state === "loading" ? (
        <span className={styles.searchState}>Searching…</span>
      ) : state === "error" ? (
        <span className={styles.searchState}>Search unavailable</span>
      ) : null}
      {expanded ? (
        <div id={listId} role="listbox" className={styles.results}>
          {items.map((item, index) => (
            <div
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(item);
              }}
            >
              <span>
                {item.name}
                {item.brand ? <small>{item.brand}</small> : null}
              </span>
              <span className={styles.resultMeta}>
                {item.caloriesPerServing != null
                  ? `${Math.round(item.caloriesPerServing)} kcal`
                  : ""}
                {item.servingLabel ? ` · ${item.servingLabel}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
