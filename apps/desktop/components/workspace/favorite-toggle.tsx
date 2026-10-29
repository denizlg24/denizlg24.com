"use client";

import { cn } from "@repo/ui/utils";
import { Star } from "lucide-react";
import { moduleForPath } from "@/lib/workspace/modules";
import { moduleRef, pageRef } from "@/lib/workspace/schema";
import { useWorkspaceStore } from "@/stores/workspace";
import { useActiveLocation } from "./sidebar";

/** Stars whatever is open — a workspace page or a module — in the title bar. */
export function FavoriteToggle() {
  const { pathname, pageId } = useActiveLocation();
  const ready = useWorkspaceStore((s) => s.ready);
  const favorites = useWorkspaceStore((s) => s.workspace.favorites);
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const toggleFavorite = useWorkspaceStore((s) => s.toggleFavorite);

  const module = pageId ? undefined : moduleForPath(pathname);
  const ref =
    pageId && pages[pageId] && !pages[pageId].deletedAt
      ? pageRef(pageId)
      : module
        ? moduleRef(module.id)
        : null;
  if (!ready || !ref) return null;
  const favorite = favorites.includes(ref);

  return (
    <button
      type="button"
      aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
      title={favorite ? "Remove from favorites" : "Add to favorites"}
      onClick={() => toggleFavorite(ref)}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded transition-colors hover:bg-surface",
        favorite
          ? "text-status-warning"
          : "text-muted-foreground hover:text-accent-strong",
      )}
    >
      <Star className={cn("size-3.5", favorite && "fill-current")} />
    </button>
  );
}
