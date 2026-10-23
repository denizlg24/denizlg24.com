import {
  focusManager,
  notifyManager,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";
import { AppState } from "react-native";
import { ApiError } from "./errors";

// React Query's default scheduler is setTimeout; Macros found timers stall in
// React Native until the next native event, so results go out on a microtask.
notifyManager.setScheduler(queueMicrotask);
onlineManager.setOnline(true);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // A refusal is an answer; an outage or an unreachable server is worth retrying.
      retry: (count, error) =>
        count < 2 && !(error instanceof ApiError && error.status < 500),
    },
    mutations: { retry: 0 },
  },
});

export function wireFocus() {
  const subscription = AppState.addEventListener("change", (state) => {
    focusManager.setFocused(state === "active");
  });
  return () => subscription.remove();
}
