import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { reachesDayTarget } from "@/api/day-targets";
import { errorMessage } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { type LogRequest, useLogActions } from "./log-actions";
import { addToPlate, type PlateItem, removeFromPlate } from "./plate-store";

function requestFor(item: PlateItem): LogRequest {
  return item.kind === "food"
    ? { kind: "food", input: item.input }
    : { kind: "recipe", input: item.input };
}

/**
 * Logs everything on the plate in one go. Each item already carries its own
 * idempotency key, so a batch retried after a partial failure cannot log the
 * successful ones twice.
 */
export function useCommitPlate(onLogged: () => void) {
  const queryClient = useQueryClient();
  const { send } = useLogActions();
  const [committing, setCommitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const mounted = useRef(true);
  // State lags a frame behind a double tap; the ref does not.
  const inFlight = useRef(false);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  async function commit(items: readonly PlateItem[]) {
    if (inFlight.current || items.length === 0) return;
    inFlight.current = true;
    setCommitting(true);
    setFailure(null);

    const reached = reachesDayTarget(
      queryClient,
      items.map((item) => ({
        logDate: item.input.logDate,
        macros: item.macros,
      })),
    );
    const feelLogged = reached ? haptics.goalReached : haptics.success;
    const outcomes = items.map((item) =>
      send(requestFor(item)).then(
        () => ({ item, error: null }),
        (error: unknown) => ({ item, error }),
      ),
    );

    if (!onlineManager.isOnline()) {
      // Queued writes are persisted and replay when the connection returns;
      // anything refused then goes back on the plate.
      removeFromPlate(items.map((item) => item.uid));
      for (const outcome of outcomes) {
        void outcome.then(({ item, error }) => {
          if (error) addToPlate(item);
        });
      }
      feelLogged();
      inFlight.current = false;
      setCommitting(false);
      onLogged();
      return;
    }

    const results = await Promise.all(outcomes);
    removeFromPlate(
      results
        .filter((result) => !result.error)
        .map((result) => result.item.uid),
    );
    const failed = results.filter((result) => result.error);
    inFlight.current = false;
    if (!mounted.current) return;
    setCommitting(false);
    if (failed.length === 0) {
      feelLogged();
      onLogged();
      return;
    }
    haptics.error();
    setFailure(
      `${failed.length} of ${items.length} weren’t logged and are still on your plate. ${errorMessage(failed[0]?.error)}`,
    );
  }

  return { commit, committing, failure, clearFailure: () => setFailure(null) };
}
