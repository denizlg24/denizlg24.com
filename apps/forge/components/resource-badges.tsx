"use client";

import { ResourceIcon } from "@repo/cloud-ui/tech-icon";
import type {
  ResourceConnectionScope,
  ResourceKind,
} from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";

/**
 * Kinds are labelled, not coloured by status — a resource has no health here.
 * The engine daemons' health is Cloud's `/engines` page; this is the store.
 *
 * The mark is decorative: the kind is written beside it, so a reader who does
 * not recognise the elephant still reads "postgres".
 */
export function ResourceKindBadge({ kind }: { kind: ResourceKind }) {
  return (
    <Badge variant="secondary" className="gap-1 font-mono text-[10px]">
      <ResourceIcon kind={kind} className="size-3" />
      {kind}
    </Badge>
  );
}

/**
 * `both` is the overwhelmingly common case — it is what every pre-split project
 * effectively had — so it reads as plain text and only a narrowed scope earns
 * an outline. An `environment` scope reads as the environment's own name:
 * "environment" says nothing, "staging" says all of it.
 */
export function ScopeBadge({
  scopes,
  environmentName,
}: {
  scopes: ResourceConnectionScope;
  environmentName?: string | null;
}) {
  if (scopes === "both") {
    return <span className="text-xs text-muted-foreground">both</span>;
  }
  return (
    <Badge variant="outline" className="max-w-40 truncate text-[10px]">
      {scopes === "environment" ? (environmentName ?? "environment") : scopes}
    </Badge>
  );
}
