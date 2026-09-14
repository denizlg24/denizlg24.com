"use client";

import { Button } from "@repo/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@repo/ui/context-menu";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { FolderPlus, SquareCheck, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  EmptyFolderIllustration,
  UnreachableIllustration,
} from "@/components/illustrations";
import { Lightbox } from "@/components/lightbox";
import { GhostTile } from "@/components/tile";
import { useBrowserCommands } from "@/lib/browser-commands";
import { keepClaimedFocus } from "@/lib/focus-claim";
import { type FolderErrorKind, useRoots } from "@/lib/queries";
import { uploads, useUploads } from "@/lib/uploads";
import { FolderHeader } from "./folder-header";
import { InlineName } from "./inline-name";
import { ItemRow, ItemTile } from "./item-view";
import { SelectionBar } from "./selection-bar";
import {
  type BrowserState,
  useBrowserController,
  useReadFileInput,
} from "./use-browser-controller";

export function Browser({ folderId }: { folderId: string }) {
  const browser = useBrowserController(folderId);
  const router = useRouter();
  const roots = useRoots();
  const {
    controller,
    creating,
    density,
    dropActive,
    rows,
    rowWindow,
    state,
    view,
  } = browser;

  const filesInput = useReadFileInput(
    browser.filesInputRef,
    browser.startUpload,
  );
  const folderInput = useReadFileInput(
    browser.folderInputRef,
    browser.startUpload,
  );
  const photosInput = useReadFileInput(
    browser.photosInputRef,
    browser.startUpload,
  );
  const cameraInput = useReadFileInput(
    browser.cameraInputRef,
    browser.startUpload,
  );

  // The shell's Upload button and the phone's `+` act on whichever folder is
  // open; this is the page answering.
  useBrowserCommands(
    useCallback(
      (command) => {
        switch (command) {
          case "new-folder":
            browser.startCreateFolder();
            break;
          case "upload-files":
            browser.filesInputRef.current?.click();
            break;
          case "upload-folder":
            browser.folderInputRef.current?.click();
            break;
          case "upload-photos":
            browser.photosInputRef.current?.click();
            break;
          case "take-photo":
            browser.cameraInputRef.current?.click();
            break;
        }
      },
      [browser],
    ),
  );

  const goHome = () => {
    const home =
      roots && "userRoot" in roots ? roots.userRoot : roots?.projectRoot;
    if (home) router.push(`/folders/${home.id}`);
  };

  const empty =
    !state.error && !state.loading && rows.length === 0 && !creating;

  return (
    <div
      ref={browser.paneRef}
      tabIndex={-1}
      onKeyDown={browser.onKeyDown}
      {...browser.paneHandlers}
      className="relative flex min-h-0 flex-1 flex-col outline-none"
    >
      <input type="file" multiple className="sr-only" {...filesInput} />
      <input
        type="file"
        multiple
        // Directory pickers are still vendor-prefixed everywhere.
        {...{ webkitdirectory: "" }}
        className="sr-only"
        {...folderInput}
      />
      <input
        type="file"
        multiple
        accept="image/*,video/*"
        className="sr-only"
        {...photosInput}
      />
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        {...cameraInput}
      />

      {browser.selection.size > 0 ? (
        <SelectionBar browser={browser} />
      ) : (
        <FolderHeader browser={browser} />
      )}

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={browser.scrollRef}
            className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
          >
            {state.error && (
              <FolderError
                kind={state.errorKind ?? "other"}
                message={state.error}
                onRetry={state.retry}
                onHome={goHome}
              />
            )}

            {!state.error && state.loading && rows.length === 0 && (
              <LoadingState view={view} />
            )}

            {empty && (
              <EmptyState
                onUpload={() => browser.filesInputRef.current?.click()}
                onNewFolder={browser.startCreateFolder}
              />
            )}

            {(rows.length > 0 || creating || !empty) &&
              !state.error &&
              !state.loading &&
              (view === "list" ? (
                <ListView browser={browser} />
              ) : (
                <GridView browser={browser} />
              ))}

            {state.hasMore && state.pagination && (
              <div className="flex justify-center p-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={state.loadingMore}
                  onClick={state.loadMore}
                >
                  {state.loadingMore
                    ? "Loading…"
                    : `Show more (${state.pagination.total - state.files.length} left)`}
                </Button>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="w-56"
          onCloseAutoFocus={keepClaimedFocus}
        >
          <ContextMenuItem onSelect={browser.startCreateFolder}>
            <FolderPlus className="size-4" />
            New folder
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => browser.filesInputRef.current?.click()}
          >
            <Upload className="size-4" />
            Upload files
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => browser.folderInputRef.current?.click()}
          >
            <FolderPlus className="size-4" />
            Upload a folder
          </ContextMenuItem>
          {rows.length > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() =>
                  browser.setSelection(new Set(rows.map((row) => row.id)))
                }
              >
                <SquareCheck className="size-4" />
                Select all
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {dropActive && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/60 bg-background/85 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2 text-center">
            <Upload className="size-8 text-primary" strokeWidth={1.5} />
            <p className="text-base font-medium">
              Drop to upload to{" "}
              {state.folder ? folderTitle(state.folder) : "this folder"}
            </p>
          </div>
        </div>
      )}

      {browser.previewId && browser.previewFiles.length > 0 && (
        <Lightbox
          files={browser.previewFiles}
          fileId={browser.previewId}
          folderId={folderId}
          ancestors={state.ancestors}
          folder={state.folder}
          onSelect={browser.openPreview}
          onClose={() => browser.openPreview(null)}
          onDelete={(file) => {
            const row = rows.find((candidate) => candidate.id === file.id);
            if (row) browser.onDelete([row]);
          }}
          onRename={(file) => {
            browser.openPreview(null);
            controller.onStartRename(file.id);
          }}
          onMove={(file, targetFolderId) => {
            const row = rows.find((candidate) => candidate.id === file.id);
            if (row) void browser.runMove([row], targetFolderId);
          }}
        />
      )}
    </div>
  );
}

function folderTitle(folder: { name: string; path: string }): string {
  if (folder.path === "/shared") return "Family";
  return folder.path.split("/").filter(Boolean).length === 1
    ? "My files"
    : folder.name;
}

/**
 * Uploads targeting this folder render as ghost tiles at the top of the grid,
 * so fifty dropped photos never read as an empty folder. When one finalizes
 * the server row takes its place by name and the ghost goes.
 */
function useGhosts(browser: BrowserState) {
  const items = useUploads();
  const names = new Set(browser.rows.map((row) => row.name));
  return items.filter(
    (item) =>
      item.targetFolderId === browser.folderId &&
      item.status !== "canceled" &&
      !(item.status === "done" && names.has(item.name)) &&
      item.status !== "done",
  );
}

function CreateDraft({
  browser,
  asRow,
}: {
  browser: BrowserState;
  asRow?: boolean;
}) {
  const field = (
    <InlineName
      className="w-full"
      initial=""
      kind="folder"
      placeholder="New folder"
      onCommit={(name) => void browser.createFolder(name)}
      onCancel={() => browser.setCreating(false)}
    />
  );
  const error = browser.createError && (
    <p className="mt-1 text-xs text-destructive" role="alert">
      {browser.createError}
    </p>
  );
  if (asRow) {
    return (
      <tr className="border-b">
        <td className="w-px pl-3 pr-2" />
        <td className="w-full max-w-0 py-2 pr-3">
          {field}
          {error}
        </td>
        <td colSpan={3} />
      </tr>
    );
  }
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-dashed p-2">
      <div
        className={cn(
          "flex w-full items-center justify-center rounded-lg bg-muted/30",
          browser.density === "compact" ? "aspect-square" : "aspect-[4/3]",
        )}
      >
        <FolderPlus className="size-10 text-kind-folder" strokeWidth={1.5} />
      </div>
      <div className="px-0.5">
        {field}
        {error}
      </div>
    </li>
  );
}

function GridView({ browser }: { browser: BrowserState }) {
  const { rows, rowWindow, density, controller } = browser;
  const ghosts = useGhosts(browser);
  return (
    <ul
      className={cn(
        "grid gap-2 p-3",
        density === "compact"
          ? "grid-cols-[repeat(auto-fill,minmax(128px,1fr))]"
          : "grid-cols-[repeat(auto-fill,minmax(168px,1fr))]",
      )}
      aria-label="Files and folders"
    >
      {browser.creating && <CreateDraft browser={browser} />}
      {ghosts.map((item) => (
        <GhostTile
          key={item.id}
          name={item.name}
          density={density}
          status={
            item.status === "done" || item.status === "canceled"
              ? "uploading"
              : item.status
          }
          percent={item.size === 0 ? 0 : (item.uploaded / item.size) * 100}
          onPause={() => uploads.pause(item.id)}
          onResume={() => uploads.resume(item.id)}
          onCancel={() => uploads.cancel(item.id)}
        />
      ))}
      {rowWindow.padTopPx > 0 && (
        <li
          aria-hidden
          className="col-span-full"
          style={{ height: rowWindow.padTopPx }}
        />
      )}
      {rows.slice(rowWindow.start, rowWindow.end).map((row) => (
        <ItemTile
          key={row.id}
          row={row}
          controller={controller}
          density={density}
          longPressHandlers={browser.longPressHandlers}
        />
      ))}
      {rowWindow.padBottomPx > 0 && (
        <li
          aria-hidden
          className="col-span-full"
          style={{ height: rowWindow.padBottomPx }}
        />
      )}
    </ul>
  );
}

function ListView({ browser }: { browser: BrowserState }) {
  const { rows, rowWindow, density, controller } = browser;
  const ghosts = useGhosts(browser);
  return (
    // Auto layout, not table-fixed: the metadata columns drop out at narrow
    // widths and a fixed layout would keep reserving their width. The name
    // cell claims the slack via w-full/max-w-0.
    <table className="w-full">
      <thead className="sr-only">
        <tr>
          <th>Select</th>
          <th>Name</th>
          <th>Size</th>
          <th>Modified</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {browser.creating && <CreateDraft browser={browser} asRow />}
        {ghosts.map((item) => (
          <tr key={item.id} className="border-b opacity-70">
            <td className="w-px pl-3 pr-2" />
            <td className="w-full max-w-0 py-2 pr-3">
              <p className="truncate text-sm">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {item.status === "error"
                  ? "Upload failed"
                  : `Uploading · ${item.size === 0 ? 0 : Math.round((item.uploaded / item.size) * 100)}%`}
              </p>
            </td>
            <td colSpan={3} />
          </tr>
        ))}
        {rowWindow.padTopPx > 0 && (
          <tr aria-hidden>
            <td colSpan={5} style={{ height: rowWindow.padTopPx }} />
          </tr>
        )}
        {rows.slice(rowWindow.start, rowWindow.end).map((row) => (
          <ItemRow
            key={row.id}
            row={row}
            controller={controller}
            density={density}
            longPressHandlers={browser.longPressHandlers}
          />
        ))}
        {rowWindow.padBottomPx > 0 && (
          <tr aria-hidden>
            <td colSpan={5} style={{ height: rowWindow.padBottomPx }} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function EmptyState({
  onUpload,
  onNewFolder,
}: {
  onUpload: () => void;
  onNewFolder: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-20 text-center">
      <EmptyFolderIllustration className="text-muted-foreground/70" />
      <div>
        <p className="text-base font-medium">Nothing here yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop files here or use Upload to add some.
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onUpload}>
          <Upload className="size-4" />
          Upload files
        </Button>
        <Button variant="outline" size="sm" onClick={onNewFolder}>
          <FolderPlus className="size-4" />
          New folder
        </Button>
      </div>
    </div>
  );
}

/**
 * Each branch is keyed on the API's status, not its message: a folder deleted
 * on another device, one the account cannot read, and a Pi that is rebooting
 * all need a different next step, and "Try again" is only right for the last.
 */
function FolderError({
  kind,
  message,
  onHome,
  onRetry,
}: {
  kind: FolderErrorKind;
  message: string;
  onHome: () => void;
  onRetry: () => void;
}) {
  const copy: Record<FolderErrorKind, { title: string; detail: string }> = {
    forbidden: {
      detail:
        "It belongs to someone else, or it was moved somewhere you can't see.",
      title: "You don't have access to this folder",
    },
    "not-found": {
      detail: "It may have been deleted or moved from another device.",
      title: "This folder was deleted or moved",
    },
    other: { detail: message, title: "Couldn't open this folder" },
    unreachable: {
      detail: "Check your connection, then try again in a moment.",
      title: "Can't reach the cloud right now",
    },
  };
  const { title, detail } = copy[kind];
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-20 text-center">
      {kind === "unreachable" ? (
        <UnreachableIllustration className="text-muted-foreground/70" />
      ) : (
        <EmptyFolderIllustration className="text-muted-foreground/70" />
      )}
      <div>
        <p className="text-base font-medium">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>
      </div>
      {kind === "not-found" || kind === "forbidden" ? (
        <Button variant="outline" size="sm" onClick={onHome}>
          Go to My files
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function LoadingState({ view }: { view: "grid" | "list" }) {
  const placeholders = Array.from({ length: 12 }, (_, index) => index);
  if (view === "list") {
    return (
      <div className="divide-y">
        {placeholders.map((index) => (
          <div key={index} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton className="size-7 rounded-md" />
            <Skeleton
              className="h-3.5 flex-1"
              style={{ maxWidth: `${40 + ((index * 13) % 40)}%` }}
            />
            <Skeleton className="hidden h-3 w-16 sm:block" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 p-3">
      {placeholders.map((index) => (
        <li key={index} className="flex flex-col gap-2 p-2">
          <Skeleton className="aspect-[4/3] w-full rounded-lg" />
          <Skeleton
            className="h-3.5"
            style={{ width: `${50 + ((index * 17) % 40)}%` }}
          />
          <Skeleton className="h-3 w-1/3" />
        </li>
      ))}
    </ul>
  );
}
