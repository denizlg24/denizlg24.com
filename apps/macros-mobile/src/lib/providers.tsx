import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { type ReactNode, useMemo } from "react";
import {
  createPersister,
  createQueryClient,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE,
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
          shouldDehydrateQuery: (query) =>
            userId !== null && query.state.status === "success",
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
        void queryClient.resumePausedMutations();
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
