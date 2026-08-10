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
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { cn } from "@repo/ui/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

export interface ProjectOption {
  slug: string;
  /** Rendered right-aligned — a count, a status, whatever the list is about. */
  detail?: string;
}

/**
 * A type-to-find project picker.
 *
 * Replaces the row of pills once there is enough to scroll past. Pills are a
 * fine control for four projects and a bad one for thirty: they wrap into a
 * block that pushes the actual data down the page, there is no way to reach a
 * given slug except by reading all of them, and the row reflows every time a
 * project appears or goes away. Keyboard-first search does not degrade with the
 * list length.
 */
export function ProjectPicker({
  options,
  selected,
  onSelect,
  allLabel,
  className,
}: {
  options: readonly ProjectOption[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
  /**
   * Label for the "no project selected" entry. Omitted when the caller always
   * has exactly one project selected, which removes the entry entirely.
   */
  allLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.slug === selected);

  const choose = (slug: string | null) => {
    onSelect(slug);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-label="Project"
          className={cn("h-7 justify-between gap-2 px-2 text-xs", className)}
        >
          <span className="truncate">
            {current?.slug ?? allLabel ?? "select project"}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="project" className="text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-xs text-muted-foreground">
              no match
            </CommandEmpty>
            <CommandGroup>
              {allLabel ? (
                <CommandItem
                  value={allLabel}
                  onSelect={() => choose(null)}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "size-3",
                      selected === null ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {allLabel}
                </CommandItem>
              ) : null}
              {options.map((option) => (
                <CommandItem
                  key={option.slug}
                  value={option.slug}
                  onSelect={() => choose(option.slug)}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "size-3",
                      selected === option.slug ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{option.slug}</span>
                  {option.detail ? (
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {option.detail}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
