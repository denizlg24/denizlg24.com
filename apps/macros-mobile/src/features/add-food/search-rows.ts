import {
  type MacrosFavoriteFood,
  type MacrosFoodHistoryItem,
  type MacrosFoodSearchItem,
  type MacrosMealTemplateListItem,
  type MacrosRecipeSummary,
  macrosEnteredUnitSchema,
} from "@repo/schemas/macros";
import type { Href } from "expo-router";
import { newClientMutationId } from "@/lib/ids";
import type { LogTimeParams } from "@/lib/log-time";
import type { FoodRowData } from "./components/food-row";
import type { LogRequest } from "./log-actions";
import type { PlateItem } from "./plate-store";
import {
  describeAmount,
  type MacroSnapshot,
  macrosFromPerServing,
} from "./serving";

/** Where and when a log from the list goes, already resolved for the profile's zone. */
export interface Placement {
  logDate: string;
  eatenAt: string;
}

/**
 * A list row that can be logged in one tap: the amount it shows is exactly
 * the amount its "+" logs — the last-used serving for history, the stored
 * default for favorites, one serving otherwise.
 */
export type QuickItem =
  | {
      kind: "food";
      row: FoodRowData;
      sourceItemId: string;
      servingLabel: string | null;
      servings: number;
      enteredQuantity: number | undefined;
      enteredUnit: "g" | "oz" | "lb" | "serving" | undefined;
      macros: MacroSnapshot;
    }
  | {
      kind: "recipe";
      row: FoodRowData;
      recipeId: string;
      servingLabel: string;
      servings: number;
      macros: MacroSnapshot;
    };

export function historyQuick(item: MacrosFoodHistoryItem): QuickItem {
  const unit = macrosEnteredUnitSchema.safeParse(item.lastEnteredUnit);
  const enteredQuantity =
    unit.success &&
    item.lastEnteredQuantity != null &&
    item.lastEnteredQuantity > 0
      ? item.lastEnteredQuantity
      : undefined;
  const servingLabel = item.lastServingLabel ?? item.servingLabel;
  const servings =
    item.lastServingsConsumed > 0 ? item.lastServingsConsumed : 1;
  const macros = macrosFromPerServing(item, servings);
  return {
    kind: "food",
    sourceItemId: item.id,
    servingLabel,
    servings,
    enteredQuantity,
    enteredUnit:
      enteredQuantity !== undefined && unit.success ? unit.data : undefined,
    macros,
    row: {
      key: item.id,
      name: item.name,
      brand: item.brand,
      iconKey: item.iconKey,
      amount: describeAmount({
        servingLabel,
        servingsConsumed: servings,
        enteredQuantity,
        enteredUnit: unit.success ? unit.data : null,
      }),
      macros,
    },
  };
}

export function searchQuick(item: MacrosFoodSearchItem): QuickItem {
  const macros = macrosFromPerServing(item, 1);
  return {
    kind: "food",
    sourceItemId: item.id,
    servingLabel: item.servingLabel,
    servings: 1,
    enteredQuantity: undefined,
    enteredUnit: undefined,
    macros,
    row: {
      key: item.id,
      name: item.name,
      brand: item.brand,
      iconKey: item.iconKey,
      amount: describeAmount({
        servingLabel: item.servingLabel,
        servingsConsumed: 1,
      }),
      macros,
    },
  };
}

export function favoriteQuick(
  favorite: MacrosFavoriteFood,
  iconKey: string | null,
): QuickItem {
  const servings = favorite.defaultServings > 0 ? favorite.defaultServings : 1;
  const macros = macrosFromPerServing(favorite, servings);
  return {
    kind: "food",
    sourceItemId: favorite.sourceItemId,
    servingLabel: favorite.servingLabel,
    servings,
    enteredQuantity: undefined,
    enteredUnit: undefined,
    macros,
    row: {
      key: favorite.sourceItemId,
      name: favorite.name,
      brand: favorite.brand,
      iconKey,
      amount: describeAmount({
        servingLabel: favorite.servingLabel,
        servingsConsumed: servings,
      }),
      macros,
    },
  };
}

export function recipeQuick(recipe: MacrosRecipeSummary): QuickItem {
  const macros = macrosFromPerServing(recipe, 1);
  return {
    kind: "recipe",
    recipeId: recipe.id,
    servingLabel: recipe.servingLabel,
    servings: 1,
    macros,
    row: {
      key: `recipe:${recipe.id}`,
      name: recipe.name,
      iconKey: recipe.iconKey,
      entryType: recipe.iconKey ? "food" : "recipe",
      amount: describeAmount({
        servingLabel: recipe.servingLabel,
        servingsConsumed: 1,
      }),
      macros,
    },
  };
}

export function templateRow(template: MacrosMealTemplateListItem): FoodRowData {
  return {
    key: `template:${template.id}`,
    name: template.name,
    entryType: "recipe",
    amount: `${template.itemCount} ${template.itemCount === 1 ? "item" : "items"}`,
  };
}

export function quickRequest(
  quick: QuickItem,
  placement: Placement,
): LogRequest {
  if (quick.kind === "recipe") {
    return {
      kind: "recipe",
      input: {
        recipeId: quick.recipeId,
        servingsConsumed: quick.servings,
        ...placement,
      },
    };
  }
  return {
    kind: "food",
    input: {
      sourceItemId: quick.sourceItemId,
      servingsConsumed: quick.servings,
      enteredQuantity: quick.enteredQuantity,
      enteredUnit: quick.enteredUnit,
      ...placement,
    },
  };
}

export function quickPlateItem(
  quick: QuickItem,
  placement: Placement,
): PlateItem {
  const uid = newClientMutationId();
  const shared = {
    uid,
    name: quick.row.name,
    brand: quick.row.brand ?? null,
    iconKey: quick.row.iconKey ?? null,
    servingLabel: quick.servingLabel,
    macros: quick.macros,
  };
  if (quick.kind === "recipe") {
    return {
      ...shared,
      kind: "recipe",
      input: {
        clientMutationId: uid,
        recipeId: quick.recipeId,
        servingsConsumed: quick.servings,
        ...placement,
      },
    };
  }
  return {
    ...shared,
    kind: "food",
    input: {
      clientMutationId: uid,
      sourceItemId: quick.sourceItemId,
      servingsConsumed: quick.servings,
      enteredQuantity: quick.enteredQuantity,
      enteredUnit: quick.enteredUnit,
      ...placement,
    },
  };
}

/** The sheet for a row, opened on the row's own amount and the list's time. */
export function quickHref(quick: QuickItem, time: LogTimeParams): Href {
  if (quick.kind === "recipe") {
    return {
      pathname: "/recipe-log/[id]",
      params: {
        id: quick.recipeId,
        name: quick.row.name,
        servings: String(quick.servings),
        ...time,
      },
    };
  }
  return {
    pathname: "/food/[id]",
    params: {
      id: quick.sourceItemId,
      name: quick.row.name,
      servings: String(quick.servings),
      ...(quick.enteredQuantity !== undefined && quick.enteredUnit
        ? { quantity: String(quick.enteredQuantity), unit: quick.enteredUnit }
        : {}),
      ...time,
    },
  };
}
