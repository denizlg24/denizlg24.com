"use client";

import type {
  ResourceConnectionScope,
  ResourceKind,
} from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";

/**
 * Kinds are labelled, not coloured by status — a resource has no health here.
 * The engine daemons' health is Cloud's `/engines` page; this is the store.
 */
export function ResourceKindBadge({ kind }: { kind: ResourceKind }) {
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      {kind}
    </Badge>
  );
}

/**
 * `both` is the overwhelmingly common case — it is what every pre-split project
 * effectively had — so it reads as plain text and only a narrowed scope earns
 * an outline.
 */
export function ScopeBadge({ scopes }: { scopes: ResourceConnectionScope }) {
  if (scopes === "both") {
    return <span className="text-xs text-muted-foreground">both</span>;
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      {scopes}
    </Badge>
  );
}
