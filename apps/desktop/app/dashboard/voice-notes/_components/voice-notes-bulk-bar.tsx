"use client";

import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Hash, Loader2, RotateCw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { formatBytes, formatSpan } from "@/components/voice-notes/format";
import { normalizeTag } from "./voice-note-tag-editor";

export type BulkAction = "retry" | "tag" | "delete";

function matchTag(_value: string, search: string, keywords?: string[]) {
  const haystack = (keywords ?? []).join(" ");
  return haystack.includes(normalizeTag(search)) ? 1 : 0;
}

function BulkTagPicker({
  suggestions,
  disabled,
  busy,
  onAddTag,
}: {
  suggestions: string[];
  disabled: boolean;
  busy: boolean;
  onAddTag: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const typed = normalizeTag(draft);
  const choose = (tag: string) => {
    setOpen(false);
    setDraft("");
    onAddTag(tag);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled}>
          {busy ? <Loader2 className="animate-spin" /> : <Hash />}
          Tag
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command filter={matchTag}>
          <CommandInput
            value={draft}
            onValueChange={setDraft}
            className="h-8 text-xs"
            placeholder="Tag"
          />
          <CommandList>
            <CommandGroup>
              {typed && !suggestions.includes(typed) && (
                <CommandItem
                  value={`new:${typed}`}
                  keywords={[typed]}
                  onSelect={() => choose(typed)}
                >
                  <Hash className="size-3" />
                  {typed}
                </CommandItem>
              )}
              {suggestions.map((tag) => (
                <CommandItem
                  key={tag}
                  value={`tag:${tag}`}
                  keywords={[tag]}
                  onSelect={() => choose(tag)}
                >
                  <Hash className="size-3" />
                  {tag}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function VoiceNotesBulkBar({
  count,
  loadedCount,
  retryableCount,
  totalDurationMs,
  totalBytes,
  busy,
  tagSuggestions,
  onToggleAll,
  onRetry,
  onAddTag,
  onDelete,
  onClear,
}: {
  count: number;
  loadedCount: number;
  retryableCount: number;
  totalDurationMs: number;
  totalBytes: number;
  busy: BulkAction | null;
  tagSuggestions: string[];
  onToggleAll: () => void;
  onRetry: () => void;
  onAddTag: (tag: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const allChecked = count === loadedCount;

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
      <Checkbox
        checked={allChecked ? true : "indeterminate"}
        onCheckedChange={onToggleAll}
        aria-label={allChecked ? "Deselect all" : "Select all loaded"}
        className="mr-1.5 size-3.5 rounded-[3px]"
      />
      <span className="shrink-0 text-xs font-medium tabular-nums text-accent-strong">
        {count}
      </span>
      <span className="mr-auto truncate text-xs tabular-nums text-muted-foreground">
        · {formatSpan(totalDurationMs)} · {formatBytes(totalBytes)}
      </span>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy !== null || retryableCount === 0}
        onClick={onRetry}
      >
        {busy === "retry" ? <Loader2 className="animate-spin" /> : <RotateCw />}
        Retry
        {retryableCount > 0 && retryableCount !== count && (
          <span className="tabular-nums text-muted-foreground">
            {retryableCount}
          </span>
        )}
      </Button>
      <BulkTagPicker
        suggestions={tagSuggestions}
        disabled={busy !== null}
        busy={busy === "tag"}
        onAddTag={onAddTag}
      />
      <ConfirmButton
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            disabled={busy !== null}
          >
            {busy === "delete" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Trash2 />
            )}
            Delete
          </Button>
        }
        title={`Delete ${count} voice ${count === 1 ? "note" : "notes"}?`}
        description={`${formatSpan(totalDurationMs)} · ${formatBytes(totalBytes)}`}
        actionLabel="Delete"
        destructive
        onConfirm={onDelete}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClear}
        aria-label="Clear selection"
      >
        <X />
      </Button>
    </div>
  );
}
