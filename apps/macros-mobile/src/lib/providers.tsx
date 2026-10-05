import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { type ReactNode, useMemo } from "react";
import {
  createPersister,
  createQueryClient,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
  restorePendingLogsFor,
} from "./query-client";

/**
 * A fresh client and persister per signed-in user. Keyed remounting is what
 * guarantees nothing from one account's cache is rendered for another.
 */
export function QueryProviders({
  userId,
  children,
}: {
  userId: string | null;
  children: ReactNode;
}) {
  const queryClient = useMemo(() => createQueryClient(), [userId]);
  const persister = useMemo(
    () => createPersister(userId ?? "signed-out"),
    [userId],
  );

  return (
    <PersistQueryClientProvider
      key={userId ?? "signed-out"}
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        buster: PERSIST_BUSTER,
        dehydrateOptions: {
          // Search results are not persisted: restored a week later they
          // showed as the answer while the refetch was still on its way.
          shouldDehydrateQuery: (query) =>
            userId !== null &&
            query.state.status === "success" &&
            !(query.queryKey[0] === "foods" && query.queryKey[1] === "search"),
          // A restored write needs a registered function to resume; one
          // without would be rejected on relaunch with nothing reported.
          shouldDehydrateMutation: (mutation) =>
            mutation.state.isPaused &&
            mutation.options.mutationKey !== undefined &&
            queryClient.getMutationDefaults(mutation.options.mutationKey)
              .mutationFn !== undefined,
        },
      }}
      onSuccess={() => {
        // Restored first, so a resumed write that lands at once is confirmed
        // rather than left counting.
        const restored = userId
          ? restorePendingLogsFor(queryClient, userId)
          : Promise.resolve();
        void restored.finally(() => queryClient.resumePausedMutations());
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
