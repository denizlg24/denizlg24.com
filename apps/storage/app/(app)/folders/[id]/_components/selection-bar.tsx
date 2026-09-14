"use client";

import { pluralize } from "@repo/cloud-ui/format";
import { Button } from "@repo/ui/button";
import { ResponsiveDialog } from "@repo/ui/responsive-dialog";
import { Download, FolderInput, Link2, Trash2, X } from "lucide-react";
import { useState } from "react";
import { MovePicker } from "./move-picker";
import { ShareSheet } from "./share-sheet";
import { type BrowserState, toEntries } from "./use-browser-controller";

/** Replaces the folder header while anything is selected. */
export function SelectionBar({ browser }: { browser: BrowserState }) {
  const [panel, setPanel] = useState<"move" | "share" | null>(null);
  const { selectedRows } = browser;
  const single = selectedRows.length === 1 ? selectedRows[0] : null;

  return (
    <div className="flex min-h-[4.25rem] items-center gap-1 border-b bg-muted/30 px-3 md:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="size-9"
        aria-label="Clear selection"
        onClick={browser.clearSelection}
      >
        <X className="size-4" />
      </Button>
      <span className="mr-2 text-sm font-medium tabular-nums">
        {pluralize(selectedRows.length, "item")} selected
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => void browser.onDownload(selectedRows)}
        >
          <Download className="size-4" />
          <span className="hidden sm:inline">Download</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => setPanel("move")}
        >
          <FolderInput className="size-4" />
          <span className="hidden sm:inline">Move</span>
        </Button>
        {single?.type === "file" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => setPanel("share")}
          >
            <Link2 className="size-4" />
            <span className="hidden sm:inline">Share</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-destructive hover:text-destructive"
          onClick={() => browser.onDelete(selectedRows)}
        >
          <Trash2 className="size-4" />
          <span className="hidden sm:inline">Delete</span>
        </Button>
      </div>

      <ResponsiveDialog
        open={panel === "move"}
        onOpenChange={(open) => !open && setPanel(null)}
        title={`Move ${pluralize(selectedRows.length, "item")}`}
        className="max-w-md"
      >
        {panel === "move" && (
          <MovePicker
            entries={toEntries(selectedRows)}
            sourceFolderId={browser.folderId}
            busy={browser.moving}
            onMove={(targetFolderId) => {
              setPanel(null);
              void browser.runMove(selectedRows, targetFolderId);
            }}
          />
        )}
      </ResponsiveDialog>
      <ResponsiveDialog
        open={panel === "share" && single !== null}
        onOpenChange={(open) => !open && setPanel(null)}
        title={single ? `Share “${single.name}”` : "Share"}
        className="max-w-md"
      >
        {panel === "share" && single && (
          <ShareSheet fileId={single.id} filename={single.name} />
        )}
      </ResponsiveDialog>
    </div>
  );
}
