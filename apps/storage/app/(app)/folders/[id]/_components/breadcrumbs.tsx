"use client";

import { pluralize } from "@repo/cloud-ui/format";
import type { FolderContents, FolderCrumb } from "@repo/schemas/cloud";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { cn } from "@repo/ui/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { activeDrag, endDrag, readDrop } from "@/lib/drag";
import { storage } from "@/lib/queries";

/** Root folders are named after an owner id, which means nothing to a person. */
export function crumbLabel(crumb: { name: string; path: string }): string {
  if (crumb.path === "/shared") return "Family";
  return crumb.path.split("/").filter(Boolean).length === 1
    ? "My files"
    : crumb.name;
}

function Crumb({
  id,
  label,
  href,
  current,
}: {
  id: string;
  label: string;
  href?: string;
  current?: boolean;
}) {
  const [over, setOver] = useState(false);

  const canAccept = (): boolean => {
    const drag = activeDrag();
    if (!drag || drag.sourceFolderId === id) return false;
    return !drag.entries.some((entry) => entry.id === id);
  };

  const handlers = {
    onDragLeave: () => setOver(false),
    onDragOver: (event: React.DragEvent) => {
      if (!canAccept()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDrop: async (event: React.DragEvent) => {
      setOver(false);
      const payload = readDrop(event.dataTransfer);
      endDrag();
      if (!payload || payload.sourceFolderId === id) return;
      event.preventDefault();
      event.stopPropagation();
      const result = await storage.move(
        payload.entries,
        payload.sourceFolderId,
        id,
      );
      if (result.failures.length > 0) {
        toast.error(
          `Couldn't move ${pluralize(result.failures.length, "item")}`,
          {
            description: result.failures[0]?.message,
          },
        );
      } else if (result.moved > 0) {
        toast.success(`Moved ${pluralize(result.moved, "item")}`);
      }
    },
  };

  const className = cn(
    "max-w-[12rem] truncate rounded-md px-1.5 py-0.5 transition-colors",
    current ? "text-foreground" : "hover:bg-muted hover:text-foreground",
    over && "ring-2 ring-inset ring-primary/60",
  );

  if (current || !href) {
    return (
      <span className={className} {...handlers} aria-current="page">
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={className} {...handlers}>
      {label}
    </Link>
  );
}

export function Breadcrumbs({
  folder,
  ancestors,
  showCurrent = true,
}: {
  folder: FolderContents["folder"];
  ancestors: FolderCrumb[];
  /** The header prints the current folder as its title, so the trail may stop short. */
  showCurrent?: boolean;
}) {
  const router = useRouter();
  // Deep trees would push the toolbar actions off a phone screen, so only the
  // first and last ancestor stay inline.
  const collapsed = ancestors.length > 2 ? ancestors.slice(1, -1) : [];
  const inline =
    ancestors.length > 2
      ? [ancestors[0] as FolderCrumb, ancestors.at(-1) as FolderCrumb]
      : ancestors;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-0.5 text-sm text-muted-foreground"
    >
      {inline.map((crumb, index) => (
        <div key={crumb.id} className="flex min-w-0 items-center gap-0.5">
          <Crumb
            id={crumb.id}
            label={crumbLabel(crumb)}
            href={`/folders/${crumb.id}`}
          />
          {(showCurrent ||
            index < inline.length - 1 ||
            collapsed.length > 0) && (
            <ChevronRight className="size-3.5 shrink-0" />
          )}
          {index === 0 && collapsed.length > 0 && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Show ${collapsed.length} more folders in this path`}
                  className="rounded px-1.5 py-0.5 hover:bg-muted"
                >
                  …
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {collapsed.map((hidden) => (
                    <DropdownMenuItem
                      key={hidden.id}
                      onSelect={() => router.push(`/folders/${hidden.id}`)}
                    >
                      {crumbLabel(hidden)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {(showCurrent || index < inline.length - 1) && (
                <ChevronRight className="size-3.5 shrink-0" />
              )}
            </>
          )}
        </div>
      ))}
      {showCurrent && (
        <Crumb id={folder.id} label={crumbLabel(folder)} current />
      )}
    </nav>
  );
}
