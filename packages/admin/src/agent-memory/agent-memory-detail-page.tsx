"use client";

import type { AgentMemory } from "@repo/schemas";
import { agentMemorySchema } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Brain } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";

const ICON = <Brain className="size-4 text-muted-foreground" />;

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}

/**
 * One memory statement, with its evidence, links and temporal bounds.
 *
 * It was a right-hand sheet over the memory table, so following a supersedes
 * or contradiction link meant closing one panel and finding the other row by
 * hand. As a page each of those ids is a link, which is the whole point of a
 * store whose records reference each other.
 */
export function AgentMemoryDetailPage({ memoryId }: { memoryId: string }) {
  const { client, routes } = useAdmin();
  const [memory, setMemory] = useState<AgentMemory | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await client.get<unknown>(
        `agent-memory/memories/${memoryId}`,
      );
      setMemory(agentMemorySchema.parse((raw as { memory?: unknown })?.memory));
    } catch {
      toast.error("Failed to load memory");
      setMemory(null);
    } finally {
      setLoading(false);
    }
  }, [client, memoryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shell = {
    icon: ICON,
    backTo: routes.agentMemory.root,
    backLabel: "Memory",
  } as const;

  if (loading) return <DetailPageSkeleton {...shell} title="Memory" rows={2} />;

  if (!memory) {
    return (
      <DetailNotFound
        {...shell}
        title="Memory not found"
        message="This memory could not be loaded."
      />
    );
  }

  return (
    <DetailPageShell {...shell} title="Memory">
      <div className="space-y-5">
        <MemoryDetailBody memory={memory} />
      </div>
    </DetailPageShell>
  );
}

function MemoryDetailBody({ memory }: { memory: AgentMemory }) {
  return (
    <>
      {memory && (
        <>
          <div>
            <p className="font-mono text-xs text-muted-foreground">
              {memory.id} · revision {memory.revision}
            </p>
          </div>
          <div className="space-y-5">
            <p className="whitespace-pre-line text-sm">{memory.statement}</p>

            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{memory.memoryType}</Badge>
              <Badge variant="outline">{memory.status}</Badge>
              <Badge variant="secondary">{memory.explicitness}</Badge>
              <Badge variant="secondary">{memory.trust}</Badge>
              <Badge variant="secondary">{memory.sensitivity}</Badge>
              {memory.pinned && <Badge>pinned</Badge>}
            </div>

            <div className="flex flex-wrap gap-6 text-xs">
              <Metric label="Confidence" value={percent(memory.confidence)} />
              <Metric label="Importance" value={percent(memory.importance)} />
              <Metric
                label="Evidence"
                value={String(memory.evidenceIds.length)}
              />
              <Metric
                label="Contradictions"
                value={String(memory.contradictionIds.length)}
              />
            </div>

            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Valid{" "}
                {memory.temporal.validFrom
                  ? `from ${formatDate(memory.temporal.validFrom)}`
                  : "from unknown"}
                {memory.temporal.validUntil
                  ? ` until ${formatDate(memory.temporal.validUntil)}`
                  : ""}{" "}
                · precision {memory.temporal.precision}
              </p>
              {memory.temporal.condition && (
                <p>Condition: {memory.temporal.condition}</p>
              )}
              <p>
                Created {formatDate(memory.createdAt)} · updated{" "}
                {formatDate(memory.updatedAt)}
              </p>
              {memory.supersedesMemoryId && (
                <p className="font-mono">
                  Supersedes {memory.supersedesMemoryId}
                </p>
              )}
            </div>

            {memory.entityRefs.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                  Linked entities
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {memory.entityRefs.map((ref) => (
                    <Badge
                      key={`${ref.entityType}:${ref.entityId}`}
                      variant="outline"
                    >
                      {ref.entityType}: {ref.label ?? ref.entityId}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {memory.evidenceIds.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                  Evidence
                </h3>
                <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                  {memory.evidenceIds.slice(0, 20).map((evidenceId) => (
                    <p key={evidenceId} className="truncate">
                      {evidenceId}
                    </p>
                  ))}
                  {memory.evidenceIds.length > 20 && (
                    <p>+{memory.evidenceIds.length - 20} more</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
