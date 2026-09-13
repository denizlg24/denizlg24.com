"use client";

import type { AgentRetrievalTrace } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Spinner } from "@repo/ui/spinner";
import { Brain, Pencil, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

interface TraceCandidate {
  memoryId: string;
  revisionId: string;
  statement: string;
  memoryType?: string;
  explicitness?: string;
  confidence?: number;
  evidenceIds: string[];
}

interface DerivedTraceItem {
  kind: "profile" | "goal" | "procedure";
  id: string;
  statement: string;
}

type FeedbackKind = "useful" | "not-relevant" | "forget" | "correction";

const FEEDBACK_LABEL: Record<FeedbackKind, string> = {
  useful: "Marked useful",
  "not-relevant": "Marked not relevant",
  forget: "Forgotten",
  correction: "Corrected",
};

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function derivedKind(value: unknown): DerivedTraceItem["kind"] | null {
  return value === "profile" || value === "goal" || value === "procedure"
    ? value
    : null;
}

function derivedItems(trace: AgentRetrievalTrace): DerivedTraceItem[] {
  const derived = trace.filters.derivedContext;
  if (!isRecord(derived) || !Array.isArray(derived.items)) return [];
  return derived.items.flatMap((item: unknown) => {
    if (!isRecord(item)) return [];
    const kind = derivedKind(item.kind);
    const id = stringField(item, "id");
    const statement = stringField(item, "statement");
    return kind && id && statement ? [{ kind, id, statement }] : [];
  });
}

function selectedCandidates(trace: AgentRetrievalTrace): TraceCandidate[] {
  const selected = new Set(trace.selectedRevisionIds);
  return trace.candidates.flatMap((candidate) => {
    const memoryId = stringField(candidate, "memoryId");
    const revisionId = stringField(candidate, "revisionId");
    const statement = stringField(candidate, "statement");
    if (!memoryId || !revisionId || !statement || !selected.has(revisionId)) {
      return [];
    }
    const confidence = candidate.confidence;
    const evidence = candidate.evidenceIds;
    return [
      {
        memoryId,
        revisionId,
        statement,
        memoryType: stringField(candidate, "memoryType"),
        explicitness: stringField(candidate, "explicitness"),
        confidence: typeof confidence === "number" ? confidence : undefined,
        evidenceIds: Array.isArray(evidence)
          ? evidence.filter((id): id is string => typeof id === "string")
          : [],
      },
    ];
  });
}

/** The memories a turn was given, with per-memory feedback. */
export function AgentMemoryDisclosure({ traceId }: { traceId: string }) {
  const { client } = useAdmin();
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<AgentRetrievalTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMemoryId, setPendingMemoryId] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const [recorded, setRecorded] = useState<Record<string, FeedbackKind>>({});

  const loadTrace = async () => {
    if (trace || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await client.get<{ trace: AgentRetrievalTrace }>(
        `agent-memory/retrieval-traces/${traceId}`,
      );
      setTrace(result.trace);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load trace");
    } finally {
      setLoading(false);
    }
  };

  const submitFeedback = async (kind: FeedbackKind, memoryId: string) => {
    if (pendingMemoryId) return;
    if (
      kind === "forget" &&
      !window.confirm("Forget this memory and remove it from retrieval?")
    ) {
      return;
    }
    const replacement = correction.trim();
    if (kind === "correction" && !replacement) return;
    setPendingMemoryId(memoryId);
    try {
      await client.post(`agent-memory/retrieval-traces/${traceId}/feedback`, {
        feedbackId: crypto.randomUUID(),
        kind,
        memoryId,
        ...(kind === "correction" ? { correction: replacement } : {}),
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Feedback failed");
      return;
    } finally {
      setPendingMemoryId(null);
    }
    setRecorded((current) => ({ ...current, [memoryId]: kind }));
    setCorrecting(null);
    setCorrection("");
  };

  const candidates = trace ? selectedCandidates(trace) : [];
  const derived = trace ? derivedItems(trace) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadTrace();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-sm text-[11px] text-muted-foreground/70 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Brain aria-hidden="true" className="size-3" />
          <span>Memory</span>
        </button>
      </DialogTrigger>
      <DialogContent className="grid max-h-[min(80dvh,48rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-sm">Memory used</DialogTitle>
          <DialogDescription className="truncate font-mono text-[11px]">
            {traceId}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-2">
          {loading ? (
            <div className="flex min-h-28 items-center justify-center text-muted-foreground">
              <Spinner className="size-4" />
            </div>
          ) : error ? (
            <div className="flex min-h-28 flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
              <p>{error}</p>
              <Button variant="outline" size="sm" onClick={loadTrace}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {derived.map((item) => (
                <div key={`${item.kind}:${item.id}`} className="space-y-1 py-4">
                  <div className="text-[10px] tracking-wider text-muted-foreground uppercase">
                    {item.kind}
                  </div>
                  <p className="text-sm leading-6 wrap-break-word">
                    {item.statement}
                  </p>
                </div>
              ))}
              {candidates.map((candidate) => {
                const pending = pendingMemoryId === candidate.memoryId;
                const feedback = recorded[candidate.memoryId];
                return (
                  <div key={candidate.revisionId} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] tracking-wider text-muted-foreground uppercase tabular-nums">
                      {candidate.memoryType ? (
                        <span>{candidate.memoryType}</span>
                      ) : null}
                      {candidate.explicitness ? (
                        <span>{candidate.explicitness}</span>
                      ) : null}
                      {candidate.confidence !== undefined ? (
                        <span>{Math.round(candidate.confidence * 100)}%</span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-6 wrap-break-word">
                      {candidate.statement}
                    </p>
                    {candidate.evidenceIds.length > 0 ? (
                      <p className="font-mono text-[10px] leading-4 break-all text-muted-foreground/60">
                        {candidate.evidenceIds.join(", ")}
                      </p>
                    ) : null}
                    {correcting === candidate.memoryId ? (
                      <div className="flex min-w-0 gap-2">
                        <Input
                          value={correction}
                          onChange={(event) =>
                            setCorrection(event.target.value)
                          }
                          className="h-8 min-w-0 text-xs"
                          aria-label="Corrected memory"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() =>
                            void submitFeedback(
                              "correction",
                              candidate.memoryId,
                            )
                          }
                          disabled={!correction.trim() || pending}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => setCorrecting(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-0.5 text-muted-foreground">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            void submitFeedback("useful", candidate.memoryId)
                          }
                          disabled={pending}
                        >
                          <ThumbsUp /> Useful
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            void submitFeedback(
                              "not-relevant",
                              candidate.memoryId,
                            )
                          }
                          disabled={pending}
                        >
                          <ThumbsDown /> Not relevant
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            setCorrecting(candidate.memoryId);
                            setCorrection(candidate.statement);
                          }}
                          disabled={pending}
                        >
                          <Pencil /> Correct
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            void submitFeedback("forget", candidate.memoryId)
                          }
                          disabled={pending}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 /> Forget
                        </Button>
                        {pending ? <Spinner className="size-3" /> : null}
                        {feedback ? (
                          <span className="ml-1 text-[11px]">
                            {FEEDBACK_LABEL[feedback]}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
