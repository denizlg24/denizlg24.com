"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { api } from "@/components/shared";
import { Button } from "@/components/ui/button";
import type { ThreadSummary } from "@/lib/memory-types";
import { ago, useNow } from "./format";

export const threadsKey = "/api/threads";

export function ThreadDrawer({
  activeId,
  onOpen,
  onDeleted,
}: {
  activeId: string;
  onOpen: (id: string) => Promise<void>;
  onDeleted: (id: string) => void;
}) {
  const now = useNow();
  const { data, error, isLoading, mutate } = useSWR<ThreadSummary[]>(
    threadsKey,
    api,
    { revalidateOnMount: true },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState("");

  async function open(id: string) {
    setBusy(id);
    setFailure("");
    try {
      await onOpen(id);
    } catch (reason) {
      setFailure(
        reason instanceof Error ? reason.message : "Could not open thread.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setFailure("");
    try {
      await api<{ ok: true }>(`/api/threads/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await mutate((current) => current?.filter((thread) => thread.id !== id), {
        revalidate: false,
      });
      onDeleted(id);
    } catch (reason) {
      setFailure(
        reason instanceof Error ? reason.message : "Could not delete thread.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="chat-drawer" aria-label="Conversation history">
      <div className="chat-drawer-head">
        <span className="kicker">History</span>
        {data ? <span className="meta">{data.length} threads</span> : null}
      </div>
      {failure || error ? (
        <p className="chat-tool-error" role="alert">
          {failure || (error instanceof Error ? error.message : "")}
        </p>
      ) : null}
      {isLoading && !data ? (
        <p className="chat-quiet">Loading conversations…</p>
      ) : data && !data.length ? (
        <p className="chat-quiet">
          No saved conversations yet. Threads are saved after each answer.
        </p>
      ) : (
        <ul className="ruled-list chat-thread-list">
          {data?.map((thread) => (
            <li
              key={thread.id}
              className="chat-thread"
              data-active={thread.id === activeId || undefined}
            >
              <button
                type="button"
                className="chat-thread-open"
                onClick={() => void open(thread.id)}
                disabled={busy === thread.id}
              >
                <span className="chat-truncate">{thread.title}</span>
                <span className="meta">
                  {busy === thread.id ? "Opening…" : ago(thread.updatedAt, now)}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete “${thread.title}”`}
                onClick={() => void remove(thread.id)}
                disabled={busy === thread.id}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
