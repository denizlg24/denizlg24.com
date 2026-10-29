"use client";

import { Button } from "@repo/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/popover";
import { Check, Plus } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

interface Props {
  /** `toolbar` renders a filter pill for PageToolbar. */
  variant?: "inline" | "toolbar";
  icon?: ReactNode;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  allowCreate?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

function normalize(t: string) {
  return t.trim().toLowerCase();
}

function formatSelectionLabel(count: number, placeholder: string) {
  if (count <= 0) return placeholder;
  return `${count} tag${count === 1 ? "" : "s"}`;
}

const TRIGGER_CLASS = {
  inline:
    "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface hover:text-accent-strong",
  toolbar:
    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-surface/60 hover:text-accent-strong data-[active]:bg-surface data-[active]:text-accent-strong dark:data-[active]:bg-muted",
} as const;

export function TagAutocomplete({
  variant = "inline",
  icon,
  value,
  onChange,
  suggestions,
  placeholder = "Add tag…",
  allowCreate = true,
  searchPlaceholder = "Search or create…",
  emptyMessage = "No tags yet",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const byKey = new Map<string, string>();

    for (const item of [...value, ...suggestions]) {
      const key = normalize(item);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, item);
    }

    return [...byKey.values()];
  }, [suggestions, value]);

  const addTag = (raw: string) => {
    const t = normalize(raw);
    if (!t) return;
    if (value.some((v) => normalize(v) === t)) return;
    onChange([...value, t]);
    setQuery("");
  };

  const removeTag = (raw: string) => {
    const key = normalize(raw);
    onChange(value.filter((v) => normalize(v) !== key));
  };

  const toggleTag = (raw: string) => {
    if (value.some((v) => normalize(v) === normalize(raw))) {
      removeTag(raw);
      return;
    }

    addTag(raw);
  };

  const showCreate =
    allowCreate &&
    query.trim().length > 0 &&
    !options.some((s) => normalize(s) === normalize(query)) &&
    !value.some((v) => normalize(v) === normalize(query));
  const triggerLabel = formatSelectionLabel(value.length, placeholder);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="inline-flex w-fit min-w-0 max-w-[min(100%,24rem)] items-center gap-1 overflow-hidden align-middle">
          <PopoverTrigger asChild>
            <button
              type="button"
              data-active={
                variant === "toolbar" && value.length > 0 ? "" : undefined
              }
              className={TRIGGER_CLASS[variant]}
            >
              {icon ?? <Plus className="size-3" />}
              {triggerLabel}
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>

      <PopoverContent
        className="w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        align="start"
        sideOffset={6}
      >
        <Command
          className="max-w-full overflow-hidden"
          filter={(value, search) => {
            if (value.toLowerCase().includes(search.toLowerCase())) return 1;
            return 0;
          }}
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim() && showCreate) {
                e.preventDefault();
                addTag(query);
                setOpen(false);
              }
            }}
          />
          <CommandList className="max-h-72 overflow-x-hidden">
            <CommandEmpty>
              {query.trim() && allowCreate ? (
                <button
                  type="button"
                  onClick={() => {
                    addTag(query);
                    setOpen(false);
                  }}
                  className="w-full px-2 py-1.5 text-left text-xs hover:bg-surface"
                >
                  Create &ldquo;{query.trim()}&rdquo;
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {emptyMessage}
                </span>
              )}
            </CommandEmpty>
            {options.length > 0 && (
              <CommandGroup heading="Tags">
                {options.map((s) => {
                  const selected = value.some(
                    (current) => normalize(current) === normalize(s),
                  );

                  return (
                    <CommandItem
                      key={s}
                      value={s}
                      onSelect={() => {
                        toggleTag(s);
                      }}
                      className="text-xs"
                    >
                      <Check
                        className={`mr-1 size-3 ${
                          selected ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {s}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {showCreate && options.length > 0 && (
              <CommandGroup heading="Create">
                <CommandItem
                  value={`__create_${query}`}
                  onSelect={() => {
                    addTag(query);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Plus className="mr-1 size-3" />
                  Create &ldquo;{query.trim()}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        {value.length > 0 && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-xs"
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
