"use client";

import { formatBytes, formatRelative, pluralize } from "@repo/cloud-ui/format";
import { Button } from "@repo/ui/button";
import { ButtonGroup } from "@repo/ui/button-group";
import { Label } from "@repo/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { ResponsiveDialog } from "@repo/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import { cn } from "@repo/ui/utils";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronLeft,
  Info,
  LayoutGrid,
  Link2,
  List,
  type LucideIcon,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { useSession } from "@/components/session-provider";
import { Breadcrumbs, crumbLabel } from "./breadcrumbs";
import { InlineName } from "./inline-name";
import {
  SORT_DIRECTION_LABELS,
  SORT_KEYS,
  SORT_LABELS,
  type SortKey,
} from "./rows";
import { ShareSheet } from "./share-sheet";
import type { BrowserState } from "./use-browser-controller";

/**
 * The folder's own line: where it is, what it is called, how much is in it,
 * and the actions that apply to the whole folder, level with its name. The
 * title renames in place except on a root, which is named by the app.
 */
export function FolderHeader({ browser }: { browser: BrowserState }) {
  const { state } = browser;
  const { user } = useSession();
  const [renaming, setRenaming] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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
    <div className="flex flex-col gap-1.5 border-b px-4 pb-3 pt-2 md:px-6">
      <div className="min-h-6">
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

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
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
                (folder && crumbLabel(folder)) || " "
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
              " "
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          <ViewMenu browser={browser} />
          {folder && !isRoot && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setShareOpen(true)}
            >
              <Link2 className="size-4" />
              <span className="hidden sm:inline">Share</span>
            </Button>
          )}
          {user.role === "superuser" && folder && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setDetailsOpen(true)}
            >
              <Info className="size-4" />
              <span className="hidden sm:inline">Details</span>
            </Button>
          )}
        </div>
      </div>

      {folder && !isRoot && (
        <ResponsiveDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          title={`Share “${crumbLabel(folder)}”`}
          className="max-w-md"
        >
          {shareOpen && (
            <ShareSheet
              target={{
                id: folder.id,
                kind: "folder",
                name: crumbLabel(folder),
              }}
            />
          )}
        </ResponsiveDialog>
      )}
      {user.role === "superuser" && folder && (
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
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col rounded-lg bg-muted p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition-colors",
            value === option.value
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.icon && <option.icon className="size-4" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Every way of looking at a folder in one panel: layout, density, what to
 * sort by and which way, and whether folders stay on top. Each choice is
 * remembered per browser.
 */
function ViewMenu({ browser }: { browser: BrowserState }) {
  const id = useId();
  const direction = SORT_DIRECTION_LABELS[browser.sortKey];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          aria-label="View options"
        >
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">View</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Layout
          </span>
          <Segmented
            label="Layout"
            value={browser.view}
            onChange={browser.setView}
            options={[
              { icon: LayoutGrid, label: "Grid", value: "grid" },
              { icon: List, label: "List", value: "list" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Density
          </span>
          <Segmented
            label="Density"
            value={browser.density}
            onChange={browser.setDensity}
            options={[
              { label: "Comfortable", value: "comfortable" },
              { label: "Compact", value: "compact" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`${id}-sort`}
            className="text-xs font-medium text-muted-foreground"
          >
            Sort by
          </Label>
          <ButtonGroup className="w-full">
            <Select
              value={browser.sortKey}
              onValueChange={(value) => browser.setSortKey(value as SortKey)}
            >
              <SelectTrigger id={`${id}-sort`} className="h-9 w-full flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="h-9 shrink-0 gap-1.5 px-2.5 font-normal"
              aria-label={`Sorted ${direction[browser.sortDirection].toLowerCase()}. Switch to ${direction[browser.sortDirection === "asc" ? "desc" : "asc"].toLowerCase()}`}
              onClick={() =>
                browser.setSortDirection(
                  browser.sortDirection === "asc" ? "desc" : "asc",
                )
              }
            >
              {browser.sortDirection === "asc" ? (
                <ArrowUpNarrowWide className="size-4" />
              ) : (
                <ArrowDownWideNarrow className="size-4" />
              )}
              <span className="text-xs">
                {direction[browser.sortDirection]}
              </span>
            </Button>
          </ButtonGroup>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${id}-folders-first`} className="text-sm">
            Folders first
          </Label>
          <Switch
            id={`${id}-folders-first`}
            checked={browser.foldersFirst}
            onCheckedChange={(checked) =>
              browser.setFoldersFirst(checked === true)
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
