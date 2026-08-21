"use client";

import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect, useState } from "react";
import { useCurrentDay } from "@/lib/app-cache/current-day";
import { createIndexedDbPersister } from "@/lib/app-cache/indexeddb-persister";
import { OfflineQueueProvider } from "@/lib/app-cache/offline-mutation-queue";
import { queryKeys } from "@/lib/app-cache/query-keys";

const staleTime = 1000 * 60 * 5;
const gcTime = 1000 * 60 * 60 * 24 * 14;

interface QueryProviderProps {
  children: React.ReactNode;
  userId: string;
}

function DayScopedCachePruner() {
  const queryClient = useQueryClient();
  const day = useCurrentDay();

  useEffect(() => {
    for (const prefix of [queryKeys.dashboard, queryKeys.calorieSummary]) {
      queryClient.removeQueries({
        queryKey: prefix,
        predicate: (query) => query.queryKey[prefix.length] !== day,
      });
    }
  }, [queryClient, day]);

  return null;
}

export function QueryProvider({ children, userId }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime,
            staleTime,
            refetchOnMount: true,
            refetchOnReconnect: "always",
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  const [persister] = useState(() => createIndexedDbPersister(userId));

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        buster: `macros-app-cache-v5:${userId}`,
        maxAge: gcTime,
        persister,
      }}
    >
      <DayScopedCachePruner />
      <OfflineQueueProvider>{children}</OfflineQueueProvider>
    </PersistQueryClientProvider>
  );
}
