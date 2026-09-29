import { useQueryClient } from "@tanstack/react-query";
import { type LoggedAmount, reachesDayTarget } from "@/api/day-targets";
import {
  type LogFoodInput,
  type LogRecipeInput,
  useLogFood,
  useLogRecipe,
} from "@/api/food-log";
import {
  type LogMealTemplateInput,
  useLogMealTemplate,
} from "@/api/meal-templates";
import { errorMessage } from "@/lib/api";
import { recordFailedWrite } from "@/lib/failed-writes";
import { haptics } from "@/lib/haptics";
import { newClientMutationId } from "@/lib/ids";
import { createStore, useStore } from "./store";

export type LogRequest =
  | { kind: "food"; input: LogFoodInput }
  | { kind: "recipe"; input: LogRecipeInput }
  | { kind: "template"; input: LogMealTemplateInput };

const lastLogged = createStore<{ key: string; at: number } | null>(null);

/** The row that just logged something, so it can flash when it is back on screen. */
export function useLastLogged() {
  return useStore(lastLogged);
}

function withIdempotencyKey(request: LogRequest): LogRequest {
  if (request.input.clientMutationId) return request;
  const clientMutationId = newClientMutationId();
  switch (request.kind) {
    case "food":
      return { kind: "food", input: { ...request.input, clientMutationId } };
    case "recipe":
      return { kind: "recipe", input: { ...request.input, clientMutationId } };
    case "template":
      return {
        kind: "template",
        input: { ...request.input, clientMutationId },
      };
  }
}

/**
 * Logs are durable the moment they are queued (persisted, idempotent, replayed
 * offline), so confirmation is immediate. A write the server refuses later
 * lands in the failure list, which the search tab shows with a retry that
 * reuses the same idempotency key.
 */
export function useLogActions() {
  const queryClient = useQueryClient();
  const logFood = useLogFood();
  const logRecipe = useLogRecipe();
  const logTemplate = useLogMealTemplate();

  function send(request: LogRequest): Promise<unknown> {
    switch (request.kind) {
      case "food":
        return logFood.mutateAsync(request.input);
      case "recipe":
        return logRecipe.mutateAsync(request.input);
      case "template":
        return logTemplate.mutateAsync(request.input);
    }
  }

  function log(
    request: LogRequest,
    name: string,
    flashKey?: string,
    macros?: LoggedAmount["macros"],
  ) {
    const stamped = withIdempotencyKey(request);
    const reached =
      macros !== undefined &&
      reachesDayTarget(queryClient, [
        { logDate: stamped.input.logDate, macros },
      ]);
    if (reached) haptics.goalReached();
    else haptics.success();
    if (flashKey) lastLogged.set({ key: flashKey, at: Date.now() });
    send(stamped).catch((error: unknown) => {
      haptics.error();
      // Retrying reuses the same idempotency key, so a request that did reach
      // the server cannot log twice.
      recordFailedWrite(name, errorMessage(error), {
        id: stamped.input.clientMutationId,
        retry: () => log(stamped, name),
      });
    });
  }

  return { log, send };
}
