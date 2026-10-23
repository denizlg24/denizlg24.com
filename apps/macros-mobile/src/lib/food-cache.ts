import {
  type MacrosCacheVersions,
  macrosCacheVersionsSchema,
} from "@repo/schemas/macros";
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

// A persistence format revision, never a release or content revision. Changing
// it discards queued mutations too, so food/icon refreshes must not use it.
export const PERSIST_BUSTER = "macros-offline-v1";
export const APPLIED_CACHE_VERSIONS_KEY = [
  "cache-versions",
  "applied",
] as const;

const FOOD_QUERY_DOMAINS = new Set([
  "foods",
  "food-log",
  "dashboard",
  "pantry",
  "recipes",
  "meal-templates",
  "shopping-list",
]);

/** Adopt the old app-version buster without throwing away paused writes. */
export function migratePersistedCache(
  client: PersistedClient,
): PersistedClient {
  return /^\d+\.\d+\.\d+:1$/.test(client.buster)
    ? { ...client, buster: PERSIST_BUSTER }
    : client;
}

/** Mark affected reads stale, retaining offline data and every queued write. */
export async function revalidateFoodCaches(
  client: QueryClient,
  next: MacrosCacheVersions,
) {
  const parsed = macrosCacheVersionsSchema.safeParse(
    client.getQueryData(APPLIED_CACHE_VERSIONS_KEY),
  );
  const previous = parsed.success ? parsed.data : undefined;
  const foodsChanged = previous?.foods !== next.foods;
  const iconsChanged = previous?.foodIcons !== next.foodIcons;
  if (!foodsChanged && !iconsChanged) return;

  const predicate = ({ queryKey }: { queryKey: readonly unknown[] }) =>
    (foodsChanged &&
      typeof queryKey[0] === "string" &&
      FOOD_QUERY_DOMAINS.has(queryKey[0])) ||
    (iconsChanged && queryKey[0] === "food-icons");

  // A response started before the bump must not repopulate a fresh cache.
  await client.cancelQueries({ predicate });
  await client.invalidateQueries({ predicate, refetchType: "none" });
  client.setQueryData(APPLIED_CACHE_VERSIONS_KEY, next);
  if (onlineManager.isOnline()) {
    await client.refetchQueries({ predicate, type: "active" });
  }
}
