"use client";

import type { SurfaceMount, WorkspaceSurfaceSummary } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { Skeleton } from "@repo/ui/skeleton";
import { RowActions } from "@repo/ui/toolbar";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowUpRight, Bot, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../provider";
import { AppIcon } from "../../workspace/page-icon";
import {
  useSurface,
  useSurfaceList,
  useSurfaceStore,
} from "../../workspace/surfaces/store";
import { SurfaceEditor } from "../../workspace/surfaces/surface-editor";
import { useWorkspaceNav } from "../../workspace/use-workspace-nav";
import { SettingsGroup } from "../settings-shell";

function useMountLabel(): (mount: SurfaceMount) => string {
  const { getModule } = useWorkspaceNav();
  return (mount) => {
    if (mount.kind === "home") return "Home";
    if (mount.kind === "module") {
      return getModule(mount.module)?.label ?? mount.module;
    }
    return "—";
  };
}

function ErrorCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge variant="critical" className="h-4 px-1 tabular-nums">
      {count}
    </Badge>
  );
}

function SurfaceRow({
  surface,
  mountLabel,
  onEdit,
  onOpen,
  onDelete,
}: {
  surface: WorkspaceSurfaceSummary;
  mountLabel: string;
  onEdit: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div role="listitem" className="group flex items-center gap-3 py-2">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <AppIcon
          value={surface.icon}
          fallback={LayoutTemplate}
          className="text-muted-foreground"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-sm text-accent-strong">
            <span className="truncate">{surface.name}</span>
            {surface.createdBy !== "owner" ? (
              <Bot
                className="size-3 shrink-0 text-muted-foreground"
                aria-label={surface.createdBy}
              />
            ) : null}
            <ErrorCount count={surface.errorCount} />
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {mountLabel}
            {surface.mount.kind !== "none" && surface.chrome === "none"
              ? " · full"
              : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end text-[11px] tabular-nums text-muted-foreground">
          <span className="font-mono">r{surface.rev}</span>
          <span>{formatDistanceToNowStrict(new Date(surface.updatedAt))}</span>
        </span>
      </button>
      <RowActions label={`${surface.name} actions`}>
        <DropdownMenuItem onSelect={onOpen}>
          <ArrowUpRight /> Open
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </RowActions>
    </div>
  );
}

/** Every surface, opened in the editor. */
export function SurfacesSection() {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const list = useSurfaceList();
  const remove = useSurfaceStore((s) => s.remove);
  const setBypass = useSurfaceStore((s) => s.setBypass);
  const mountLabel = useMountLabel();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceSurfaceSummary | null>(
    null,
  );
  const loaded = useSurface(editing === "new" ? null : editing);
  const editingSurface = loaded && loaded !== "missing" ? loaded : null;

  useEffect(() => {
    if (loaded === "missing") setEditing(null);
  }, [loaded]);

  const open = (id: string) => {
    setBypass(false);
    router.push(routes.surface(id));
  };

  return (
    <SettingsGroup
      label="Surfaces"
      actions={
        <Button variant="ghost" size="xs" onClick={() => setEditing("new")}>
          <Plus /> New
        </Button>
      }
    >
      {list === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : list.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <div role="list" className="flex flex-col divide-y divide-border">
          {list.map((surface) => (
            <SurfaceRow
              key={surface.id}
              surface={surface}
              mountLabel={mountLabel(surface.mount)}
              onEdit={() => setEditing(surface.id)}
              onOpen={() => open(surface.id)}
              onDelete={() => setDeleting(surface)}
            />
          ))}
        </div>
      )}
      <SurfaceEditor
        open={editing === "new" || editingSurface !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        surface={editing === "new" ? null : editingSurface}
        onCreated={(created) => setEditing(created.id)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? "surface"}?`}
        actionLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove(client, deleting.id);
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Delete failed",
            );
          } finally {
            setDeleting(null);
          }
        }}
      />
    </SettingsGroup>
  );
}
