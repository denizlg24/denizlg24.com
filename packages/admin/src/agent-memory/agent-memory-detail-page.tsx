"use client";

import type { AgentMemory } from "@repo/schemas";
import { agentMemorySchema } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { Stat, StatGroup } from "@repo/ui/stat";
import { Brain } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";

const ICON = <Brain />;

const EVIDENCE_PREVIEW = 20;

const memoryResponseSchema = z.object({ memory: agentMemorySchema });

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
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
      setMemory(memoryResponseSchema.parse(raw).memory);
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

  if (loading) return <DetailPageSkeleton {...shell} title="Memory" rows={4} />;

  if (!memory) {
    return (
      <DetailNotFound
        {...shell}
        title="Memory not found"
        message="Memory not found"
      />
    );
  }

  return (
    <DetailPageShell {...shell} title={memory.memoryType}>
      <MemoryDetailBody
        memory={memory}
        hrefFor={(id) => routes.agentMemory.detail(id)}
      />
    </DetailPageShell>
  );
}

function MemoryLink({ id, href }: { id: string; href: string }) {
  return (
    <Link
      href={href}
      className="block truncate font-mono text-xs text-accent-strong underline-offset-4 hover:underline"
    >
      {id}
    </Link>
  );
}

function MemoryDetailBody({
  memory,
  hrefFor,
}: {
  memory: AgentMemory;
  hrefFor: (id: string) => string;
}) {
  const { temporal } = memory;
  return (
    <>
      <PageTitle
        title={<span className="whitespace-pre-line">{memory.statement}</span>}
        meta={
          <>
            <Badge variant="outline">{memory.memoryType}</Badge>
            <Badge variant={memory.status === "active" ? "good" : "secondary"}>
              {memory.status}
            </Badge>
            {memory.pinned && <Badge variant="info">pinned</Badge>}
            <span className="font-mono">{memory.id}</span>
            <span className="tabular-nums">rev {memory.revision}</span>
          </>
        }
      />

      <StatGroup>
        <Stat label="Confidence" value={percent(memory.confidence)} />
        <Stat label="Importance" value={percent(memory.importance)} />
        <Stat label="Evidence" value={memory.evidenceIds.length} />
        <Stat
          label="Contradictions"
          value={memory.contradictionIds.length}
          tone={memory.contradictionIds.length > 0 ? "warning" : "default"}
        />
      </StatGroup>

      <Properties>
        <Property label="Explicitness">{memory.explicitness}</Property>
        <Property label="Trust">{memory.trust}</Property>
        <Property label="Sensitivity">{memory.sensitivity}</Property>
        <Property label="Valid from">
          {temporal.validFrom ? formatDate(temporal.validFrom) : "—"}
        </Property>
        <Property label="Valid until">
          {temporal.validUntil ? formatDate(temporal.validUntil) : "—"}
        </Property>
        <Property label="Precision">{temporal.precision}</Property>
        {temporal.condition && (
          <Property label="Condition">{temporal.condition}</Property>
        )}
        <Property label="Created">{formatDate(memory.createdAt)}</Property>
        <Property label="Updated">{formatDate(memory.updatedAt)}</Property>
        {memory.supersedesMemoryId && (
          <Property label="Supersedes">
            <MemoryLink
              id={memory.supersedesMemoryId}
              href={hrefFor(memory.supersedesMemoryId)}
            />
          </Property>
        )}
      </Properties>

      {memory.contradictionIds.length > 0 && (
        <Section title="Contradicts" count={memory.contradictionIds.length}>
          <div className="flex flex-col gap-1">
            {memory.contradictionIds.map((id) => (
              <MemoryLink key={id} id={id} href={hrefFor(id)} />
            ))}
          </div>
        </Section>
      )}

      {memory.entityRefs.length > 0 && (
        <Section title="Entities" count={memory.entityRefs.length}>
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
        </Section>
      )}

      {memory.evidenceIds.length > 0 && (
        <Section title="Evidence" count={memory.evidenceIds.length}>
          <div className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">
            {memory.evidenceIds.slice(0, EVIDENCE_PREVIEW).map((evidenceId) => (
              <p key={evidenceId} className="truncate">
                {evidenceId}
              </p>
            ))}
            {memory.evidenceIds.length > EVIDENCE_PREVIEW && (
              <p>+{memory.evidenceIds.length - EVIDENCE_PREVIEW}</p>
            )}
          </div>
        </Section>
      )}
    </>
  );
}
