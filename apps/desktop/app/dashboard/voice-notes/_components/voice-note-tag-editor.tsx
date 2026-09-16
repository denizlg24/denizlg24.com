"use client";

import { VOICE_NOTE_MAX_TAGS } from "@repo/schemas";
import { X } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

const MAX_TAG_LENGTH = 40;
const MAX_SUGGESTIONS = 8;

/** Mirrors the server's lowercase + trim, so the optimistic chip matches what comes back. */
export function normalizeTag(value: string) {
  return value.trim().toLowerCase().replace(/^#+/, "").slice(0, MAX_TAG_LENGTH);
}

export function VoiceNoteTagEditor({
  tags,
  suggestions,
  disabled,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  disabled?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const listboxId = useId();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const typed = normalizeTag(draft);
  const matches = suggestions
    .filter((tag) => !tags.includes(tag) && (!typed || tag.includes(typed)))
    .slice(0, MAX_SUGGESTIONS);
  const open = focused && matches.length > 0;
  const full = tags.length >= VOICE_NOTE_MAX_TAGS;

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    setDraft("");
    setActiveIndex(-1);
    if (!tag || tags.includes(tag) || full) return;
    onChange([...tags, tag]);
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="group/tag inline-flex h-5 items-center gap-0.5 rounded-sm bg-muted/60 pr-0.5 pl-1.5 text-[11px]"
        >
          <span className="text-muted-foreground">#</span>
          {tag}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(tags.filter((item) => item !== tag))}
            className="flex size-3.5 items-center justify-center rounded-sm text-muted-foreground opacity-50 hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover/tag:opacity-100"
            aria-label={`Remove tag ${tag}`}
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}

      {!full && (
        <div className="relative">
          <input
            value={draft}
            disabled={disabled}
            onChange={(event) => {
              setDraft(event.target.value);
              setActiveIndex(-1);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              setActiveIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && open) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % matches.length);
              } else if (event.key === "ArrowUp" && open) {
                event.preventDefault();
                setActiveIndex((index) =>
                  index <= 0 ? matches.length - 1 : index - 1,
                );
              } else if (event.key === "Enter" || event.key === ",") {
                const chosen = open ? matches[activeIndex] : undefined;
                if (!chosen && !typed) return;
                event.preventDefault();
                add(chosen ?? typed);
              } else if (event.key === "Backspace" && !draft && tags.length) {
                onChange(tags.slice(0, -1));
              } else if (event.key === "Escape") {
                setDraft("");
                event.currentTarget.blur();
              }
            }}
            placeholder="+ tag"
            maxLength={MAX_TAG_LENGTH + 1}
            role="combobox"
            aria-label="Add tag"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={
              open && activeIndex >= 0
                ? `${listboxId}-${activeIndex}`
                : undefined
            }
            className="h-5 w-24 bg-transparent px-1 text-[11px] outline-none placeholder:text-muted-foreground/60"
          />
          {open && (
            <div
              id={listboxId}
              role="listbox"
              className="absolute top-full left-0 z-30 mt-1 min-w-36 rounded-md border bg-popover p-1 shadow-md"
            >
              {matches.map((tag, index) => (
                <div
                  key={tag}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(tag)}
                  className={cn(
                    "cursor-default rounded-sm px-2 py-1 text-[11px]",
                    index === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/60",
                  )}
                >
                  <span className="text-muted-foreground">#</span>
                  {tag}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
