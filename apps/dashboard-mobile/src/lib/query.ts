import {
  type DehydratedState,
  dehydrate,
  focusManager,
  hydrate,
  notifyManager,
  onlineManager,
  type Query,
  QueryClient,
} from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { AppState } from "react-native";

// A home-screen app is resumed, not reopened: refetch whenever it returns.
// React Query's default scheduler is setTimeout; Macros found timers stall in
// React Native until the next native event, so results go out on a microtask.
notifyManager.setScheduler(queueMicrotask);
onlineManager.setOnline(true);

/** How long a restored answer may stand in while the network catches up. */
const PERSIST_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
const PERSIST_THROTTLE_MS = 3_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    // Restored queries must outlive a cold start, or hydration is thrown away
    // before the first screen asks for them.
    queries: { staleTime: 15_000, gcTime: PERSIST_MAX_AGE_MS, retry: 1 },
    mutations: { retry: 0 },
  },
});

/** Never on disk: message bodies, one-time codes, rendered images, whole agent threads. */
const UNPERSISTED_ROOTS = new Set(["email", "authenticator", "board"]);

function persistable(query: Query) {
  if (query.state.status !== "success") return false;
  const [root] = query.queryKey;
  if (typeof root !== "string" || UNPERSISTED_ROOTS.has(root)) return false;
  return !(root === "conversations" && query.queryKey.length > 1);
}

const cacheFile = new File(Paths.cache, "query-cache.json");

interface PersistedCache {
  savedAt: number;
  state: DehydratedState;
}

function isPersistedCache(value: unknown): value is PersistedCache {
  return (
    typeof value === "object" &&
    value !== null &&
    "savedAt" in value &&
    typeof value.savedAt === "number" &&
    "state" in value &&
    typeof value.state === "object" &&
    value.state !== null
  );
}

/** Seeds the cache from the last session, so every tab paints before its first request lands. */
export function restoreQueries() {
  try {
    if (!cacheFile.exists) return;
    const parsed: unknown = JSON.parse(cacheFile.textSync());
    if (
      isPersistedCache(parsed) &&
      Date.now() - parsed.savedAt < PERSIST_MAX_AGE_MS
    ) {
      hydrate(queryClient, parsed.state);
    }
  } catch {
    forgetQueries();
  }
}

function persistQueries() {
  try {
    const payload: PersistedCache = {
      savedAt: Date.now(),
      state: dehydrate(queryClient, { shouldDehydrateQuery: persistable }),
    };
    cacheFile.write(JSON.stringify(payload));
  } catch (error) {
    console.warn("[query] persisting the cache failed", error);
  }
}

export function forgetQueries() {
  try {
    if (cacheFile.exists) cacheFile.delete();
  } catch {}
}

export function wireFocus() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      persistQueries();
    }, PERSIST_THROTTLE_MS);
  };
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success") {
      schedule();
    }
  });
  const subscription = AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");
    if (state === "background") persistQueries();
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
    subscription.remove();
  };
}
