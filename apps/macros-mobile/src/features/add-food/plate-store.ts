import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  macrosDailyMacrosSchema,
  macrosLogFoodBodySchema,
  macrosLogRecipeBodySchema,
} from "@repo/schemas/macros";
import { useEffect } from "react";
import { z } from "zod";
import { useProfile } from "@/api/profile";
import { createStore, useStore } from "@/lib/store";

const staged = {
  uid: z.uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  iconKey: z.string().nullable(),
  servingLabel: z.string().nullable(),
  macros: macrosDailyMacrosSchema,
};

// Local state, not a wire type: the log body each item will be sent with,
// plus the display fields the plate needs before anything is logged. Parsing
// strips the meal an older build stored with an item.
const plateItemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...staged,
    kind: z.literal("food"),
    input: macrosLogFoodBodySchema,
  }),
  z.object({
    ...staged,
    kind: z.literal("recipe"),
    input: macrosLogRecipeBodySchema,
  }),
]);

export type PlateItem = z.infer<typeof plateItemSchema>;

const plate = createStore<PlateItem[]>([]);
let activeKey: string | null = null;
let loaded = false;

function readItems(raw: string | null): PlateItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const result = plateItemSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

plate.subscribe(() => {
  if (!activeKey || !loaded) return;
  const items = plate.get();
  const write =
    items.length > 0
      ? AsyncStorage.setItem(activeKey, JSON.stringify(items))
      : AsyncStorage.removeItem(activeKey);
  write.catch(() => undefined);
});

/**
 * One plate per account: a phone handed to someone else must not offer to log
 * the previous person's staged food.
 */
async function activate(userId: string) {
  const key = `macros-plate:${userId}`;
  if (activeKey === key) return;
  activeKey = key;
  loaded = false;
  plate.set([]);
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  if (activeKey !== key) return;
  const stored = readItems(raw);
  // Anything staged while the stored plate was loading is kept after it.
  const added = plate
    .get()
    .filter((item) => !stored.some((existing) => existing.uid === item.uid));
  loaded = true;
  plate.set([...stored, ...added]);
}

export function usePlate(): PlateItem[] {
  const userId = useProfile().data?.userId;
  useEffect(() => {
    if (userId) void activate(userId);
  }, [userId]);
  return useStore(plate);
}

export function addToPlate(item: PlateItem) {
  plate.set((items) => [
    ...items.filter((existing) => existing.uid !== item.uid),
    item,
  ]);
}

export function replacePlateItem(item: PlateItem) {
  plate.set((items) =>
    items.map((existing) => (existing.uid === item.uid ? item : existing)),
  );
}

export function removeFromPlate(uids: readonly string[]) {
  if (uids.length === 0) return;
  plate.set((items) => items.filter((item) => !uids.includes(item.uid)));
}

export function clearPlate() {
  plate.set([]);
}

/**
 * Staged items keep the icon they were staged with; an edit to the food or
 * recipe behind them repaints them in place.
 */
export function repaintPlate(
  matches: (item: PlateItem) => boolean,
  iconKey: string | null,
) {
  plate.set((items) =>
    items.some((item) => matches(item) && item.iconKey !== iconKey)
      ? items.map((item) => (matches(item) ? { ...item, iconKey } : item))
      : items,
  );
}

export function findPlateItem(uid: string | undefined): PlateItem | undefined {
  return uid ? plate.get().find((item) => item.uid === uid) : undefined;
}

export function plateTotals(items: readonly PlateItem[]) {
  return items.reduce(
    (total, item) => ({
      calories: total.calories + item.macros.calories,
      protein: total.protein + item.macros.protein,
      carbs: total.carbs + item.macros.carbs,
      fat: total.fat + item.macros.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}
