"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getQueryClient, usePendingDeleteFlush } from "@/lib/queries";

export function StorageQueryProvider({ children }: { children: ReactNode }) {
  usePendingDeleteFlush();
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
