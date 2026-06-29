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
import { useMemo, useState } from "react";

interface TagAutocompleteProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  allowCreate?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

function normalize(tag: string) {
  return tag.trim().toLowerCase();
}

function formatSelectionLabel(count: number, placeholder: string) {
  if (count <= 0) return placeholder;
  return `${count} tag${count === 1 ? "" : "s"}`;
}

export function TagAutocomplete({
  value,
  onChange,
  suggestions,
  placeholder = "Add tag...",
  allowCreate = true,
  searchPlaceholder = "Search or create...",
  emptyMessage = "No tags yet",
}: TagAutocompleteProps) {
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
    const tag = normalize(raw);
    if (!tag) return;
    if (value.some((current) => normalize(current) === tag)) return;
    onChange([...value, tag]);
    setQuery("");
  };

  const removeTag = (raw: string) => {
    const key = normalize(raw);
    onChange(value.filter((current) => normalize(current) !== key));
  };

  const toggleTag = (raw: string) => {
    if (value.some((current) => normalize(current) === normalize(raw))) {
      removeTag(raw);
      return;
    }

    addTag(raw);
  };

  const showCreate =
    allowCreate &&
    query.trim().length > 0 &&
    !options.some((option) => normalize(option) === normalize(query)) &&
    !value.some((current) => normalize(current) === normalize(query));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="inline-flex w-fit min-w-0 max-w-[min(100%,24rem)] items-center gap-1 overflow-hidden align-middle">
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-dashed px-1.5 text-[10px] text-muted-foreground hover:border-solid hover:text-foreground"
            >
              <Plus className="size-2.5" />
              {formatSelectionLabel(value.length, placeholder)}
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
          filter={(commandValue, search) =>
            commandValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim() && showCreate) {
                event.preventDefault();
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
                  className="w-full px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  Create "{query.trim()}"
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {emptyMessage}
                </span>
              )}
            </CommandEmpty>
            {options.length > 0 && (
              <CommandGroup heading="Tags">
                {options.map((option) => {
                  const selected = value.some(
                    (current) => normalize(current) === normalize(option),
                  );

                  return (
                    <CommandItem
                      key={option}
                      value={option}
                      onSelect={() => toggleTag(option)}
                      className="text-xs"
                    >
                      <Check
                        className={`mr-1 size-3 ${
                          selected ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      {option}
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
                  Create "{query.trim()}"
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
