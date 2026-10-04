import { useMutationState } from "@tanstack/react-query";
import { useOnline } from "@/lib/online";
import { InlineNotice } from "@/ui";

/**
 * Log writes made offline wait in the mutation cache. Until they replay the
 * totals above cannot include them, so say why the ring has not moved.
 * Online, the plate's serial writes are `isPaused` too while they queue, so
 * only count them while the phone actually is offline.
 */
export function PendingSyncNotice() {
  const online = useOnline();
  const paused = useMutationState({
    filters: {
      status: "pending",
      predicate: (mutation) => mutation.state.isPaused,
    },
    select: (mutation) => mutation.mutationId,
  });

  if (online || paused.length === 0) return null;

  return (
    <InlineNotice
      tone="offline"
      message={
        paused.length === 1
          ? "1 change will sync when you’re back online."
          : `${paused.length} changes will sync when you’re back online.`
      }
    />
  );
}
