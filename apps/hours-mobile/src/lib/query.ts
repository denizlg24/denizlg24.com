import {
  focusManager,
  notifyManager,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";
import { AppState } from "react-native";

// A home-screen app is resumed, not reopened: refetch whenever it returns.
// React Query's default scheduler is setTimeout; Macros found timers stall in
// React Native until the next native event, so results go out on a microtask.
notifyManager.setScheduler(queueMicrotask);
onlineManager.setOnline(true);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1 },
    mutations: { retry: 0 },
  },
});

export function wireFocus() {
  const subscription = AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");
  });
  return () => subscription.remove();
}
