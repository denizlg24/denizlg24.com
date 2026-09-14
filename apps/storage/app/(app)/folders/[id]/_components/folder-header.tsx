"use client";

import { formatBytes, formatRelative, pluralize } from "@repo/cloud-ui/format";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { ResponsiveDialog } from "@repo/ui/responsive-dialog";
import {
  ChevronLeft,
  Info,
  LayoutGrid,
  List,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "@/components/session-provider";
import { Breadcrumbs, crumbLabel } from "./breadcrumbs";
import { InlineName } from "./inline-name";
import { SORT_KEYS, SORT_LABELS } from "./rows";
import type { BrowserState } from "./use-browser-controller";

/**
 * The folder's own line: where it is, what it is called, how much is in it,
 * and the one menu that holds every view choice. The title renames in place
 * except on a root, which is named by the app.
 */
export function FolderHeader({ browser }: { browser: BrowserState }) {
  const { state } = browser;
  const { user } = useSession();
  const [renaming, setRenaming] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const folder = state.folder;
  const isRoot = folder?.parentId === null;
  const parent = state.ancestors.at(-1) ?? null;
  const total = state.pagination?.total ?? null;
  const loadedBytes = state.files.reduce(
    (sum, file) => sum + file.sizeBytes,
    0,
  );
  const itemCount = total === null ? null : total + state.subfolders.length;
  const newest = state.files.reduce<string | null>(
    (latest, file) =>
      latest === null || file.updatedAt > latest ? file.updatedAt : latest,
    null,
  );

  return (
    <div className="flex flex-col gap-1 border-b px-4 pb-3 pt-2 md:px-6">
      <div className="flex min-h-8 items-center gap-2">
        <div className="min-w-0 flex-1">
          {folder && parent && (
            <Link
              href={`/folders/${parent.id}`}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:hidden"
            >
              <ChevronLeft className="size-4" />
              <span className="truncate">{crumbLabel(parent)}</span>
            </Link>
          )}
          {folder && (
            <div className="hidden md:block">
              <Breadcrumbs
                folder={folder}
                ancestors={state.ancestors}
                showCurrent={false}
              />
            </div>
          )}
        </div>
        <ViewMenu browser={browser} />
        {user.role === "superuser" && folder && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setDetailsOpen(true)}
            >
              <Info className="size-4" />
              <span className="hidden sm:inline">Details</span>
            </Button>
            <ResponsiveDialog
              open={detailsOpen}
              onOpenChange={setDetailsOpen}
              title={crumbLabel(folder)}
              description="Owner details for this folder."
              className="max-w-md"
            >
              <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Path</dt>
                <dd className="break-all font-mono text-xs">{folder.path}</dd>
                <dt className="text-muted-foreground">Id</dt>
                <dd className="break-all font-mono text-xs">{folder.id}</dd>
                <dt className="text-muted-foreground">Loaded</dt>
                <dd>
                  {pluralize(state.files.length, "file")} ·{" "}
                  {formatBytes(loadedBytes)}
                </dd>
                <dt className="text-muted-foreground">Stored on</dt>
                <dd>
                  {(["ssd", "hdd"] as const)
                    .map(
                      (tier) =>
                        `${state.files.filter((file) => file.tier === tier).length} ${tier.toUpperCase()}`,
                    )
                    .join(" · ")}
                </dd>
                <dt className="text-muted-foreground">Subfolders</dt>
                <dd>{state.subfolders.length}</dd>
              </dl>
            </ResponsiveDialog>
          </>
        )}
      </div>

      <div className="min-w-0">
        {folder && renaming && !isRoot ? (
          <InlineName
            className="max-w-md text-xl"
            initial={folder.name}
            kind="folder"
            onCommit={(value) => {
              setRenaming(false);
              void browser.renameFolder(value);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">
            {folder && !isRoot ? (
              <button
                type="button"
                className="max-w-full truncate rounded-md text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Click to rename"
                onClick={() => setRenaming(true)}
              >
                {crumbLabel(folder)}
              </button>
            ) : (
              (folder && crumbLabel(folder)) || "\u00a0"
            )}
          </h1>
        )}
        <p className="truncate text-sm text-muted-foreground">
          {folder && itemCount !== null ? (
            <>
              {itemCount === 0 ? "No items" : pluralize(itemCount, "item")}
              {loadedBytes > 0 && ` · ${formatBytes(loadedBytes)}`}
              {newest && ` · updated ${formatRelative(newest)}`}
              {state.refreshing && " · checking…"}
            </>
          ) : (
            " "
          )}
        </p>
      </div>
    </div>
  );
}

function ViewMenu({ browser }: { browser: BrowserState }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          aria-label="View options"
        >
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">View</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup
          value={browser.view}
          onValueChange={(value) =>
            browser.setView(value === "list" ? "list" : "grid")
          }
        >
          <DropdownMenuRadioItem value="grid">
            <LayoutGrid className="size-4" />
            Grid
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="list">
            <List className="size-4" />
            List
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={browser.density}
          onValueChange={(value) =>
            browser.setDensity(value === "compact" ? "compact" : "comfortable")
          }
        >
          <DropdownMenuRadioItem value="comfortable">
            Comfortable
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={browser.sortKey}
          onValueChange={(value) =>
            browser.setSortKey(value as (typeof SORT_KEYS)[number])
          }
        >
          {SORT_KEYS.map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {SORT_LABELS[key]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuRadioGroup
          value={browser.sortDirection}
          onValueChange={(value) =>
            browser.setSortDirection(value === "desc" ? "desc" : "asc")
          }
        >
          <DropdownMenuRadioItem value="asc">
            {browser.sortKey === "updated" ? "Oldest first" : "A to Z"}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">
            {browser.sortKey === "updated" ? "Newest first" : "Z to A"}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={browser.foldersFirst}
          onCheckedChange={(checked) =>
            browser.setFoldersFirst(checked === true)
          }
        >
          Folders first
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
