"use client"

import { QueryClient } from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { useState } from "react"
import { createIndexedDbPersister } from "@/lib/app-cache/indexeddb-persister"

const staleTime = 1000 * 60 * 5
const gcTime = 1000 * 60 * 60 * 24 * 14

interface QueryProviderProps {
  children: React.ReactNode
  userId: string
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
      })
  )
  const [persister] = useState(() => createIndexedDbPersister(userId))

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        buster: `macros-app-cache-v4:${userId}`,
        maxAge: gcTime,
        persister,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
