"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { removeOptimisticNutritionEntries } from "@/lib/optimistic-nutrition";

const DATABASE_NAME = "macros-offline-mutations";
const DATABASE_VERSION = 1;
const STORE_NAME = "queue";

type QueuedMutation = {
  id: string;
  endpoint: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body: unknown;
  createdAt: string;
};

function openQueue() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openQueue();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function isQueuedMutation(value: unknown): value is QueuedMutation {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "endpoint" in value &&
    "method" in value &&
    "body" in value
  );
}

export async function queueOfflineMutation(
  mutation: Omit<QueuedMutation, "createdAt">,
) {
  if (typeof indexedDB === "undefined") {
    throw new Error("Offline storage is unavailable");
  }
  await withStore("readwrite", (store) =>
    store.put({ ...mutation, createdAt: new Date().toISOString() }),
  );
}

async function listQueuedMutations(): Promise<QueuedMutation[]> {
  const values = await withStore("readonly", (store) => store.getAll());
  return Array.isArray(values)
    ? values
        .filter(isQueuedMutation)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
}

async function deleteQueuedMutation(id: string) {
  await withStore("readwrite", (store) => store.delete(id));
}

async function flushQueue(): Promise<string[]> {
  if (!navigator.onLine) return [];
  const completed: string[] = [];
  for (const mutation of await listQueuedMutations()) {
    let response: Response;
    try {
      response = await fetch(mutation.endpoint, {
        method: mutation.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mutation.body),
      });
    } catch {
      break;
    }
    if (!response.ok && response.status >= 500) break;
    await deleteQueuedMutation(mutation.id);
    completed.push(mutation.id);
  }
  return completed;
}

export function OfflineQueueProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const sync = async () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) return;
      setSyncing(true);
      try {
        const completed = await flushQueue();
        if (completed.length > 0) {
          removeOptimisticNutritionEntries(completed);
          await queryClient.invalidateQueries();
        }
      } finally {
        setSyncing(false);
      }
    };
    const markOffline = () => setOnline(false);
    void sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", markOffline);
    };
  }, [queryClient]);

  return (
    <>
      {!online || syncing ? (
        <div
          role="status"
          className="macros-fixed-inset-x fixed top-0 z-50 bg-foreground px-3 py-2 text-center text-xs font-medium text-background"
        >
          {syncing
            ? "Syncing saved entries…"
            : "Offline — entries will sync when connected"}
        </div>
      ) : null}
      {children}
    </>
  );
}
