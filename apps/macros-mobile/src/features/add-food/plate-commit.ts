import { useQueryClient } from "@tanstack/react-query";
import { reachesDayTarget } from "@/api/day-targets";
import { showLogged } from "@/api/food-log";
import { haptics } from "@/lib/haptics";
import {
  type LogRequest,
  useLogActions,
  withIdempotencyKey,
} from "./log-actions";
import { addToPlate, type PlateItem, removeFromPlate } from "./plate-store";

function requestFor(item: PlateItem): LogRequest {
  return item.kind === "food"
    ? { kind: "food", input: item.input }
    : { kind: "recipe", input: item.input };
}

/**
 * Logs everything on the plate in one go, optimistically: the plate empties
 * and the totals move at once, and the writes run behind it. Each is
 * persisted, idempotent and replayed offline; one the server refuses goes
 * back on the plate, and its registered default records the failure.
 */
export function useCommitPlate(onLogged: () => void) {
  const queryClient = useQueryClient();
  const { send } = useLogActions();

  function commit(items: readonly PlateItem[]) {
    if (items.length === 0) return;
    const reached = reachesDayTarget(
      queryClient,
      items.map((item) => ({
        logDate: item.input.logDate,
        macros: item.macros,
      })),
    );
    removeFromPlate(items.map((item) => item.uid));
    for (const item of items) {
      // Keyed before sending, so the totals follow this exact write.
      const request = withIdempotencyKey(requestFor(item));
      showLogged(
        request.input.clientMutationId,
        request.input.logDate,
        item.macros,
      );
      send(request).catch(() => {
        haptics.error();
        addToPlate(item);
      });
    }
    if (reached) haptics.goalReached();
    else haptics.success();
    onLogged();
  }

  return { commit };
}
