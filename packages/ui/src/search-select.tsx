"use client";

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "./button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "./utils";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Shown on the closed trigger instead of `label` — for when the full label
   *  is too long for a narrow control (a currency code rather than its name). */
  triggerLabel?: string;
  /** Extra text the filter matches on but that isn't rendered. */
  keywords?: string;
  /** Rendered on the right of the row — a code, a count, a swatch. */
  meta?: ReactNode;
}

/**
 * A filterable single-select. Use instead of a long `Select` whenever the list
 * is big enough that typing beats scrolling (countries, currencies, categories).
 */
export function SearchSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select",
  searchPlaceholder = "Search",
  emptyLabel = "No match",
  disabled,
  className,
  contentClassName,
  id,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          // min-w-0 so the trigger can shrink inside a flex or grid track
          // instead of forcing the row wider than its container.
          className={cn(
            "w-full min-w-0 justify-between font-normal",
            className,
          )}
        >
          <span
            className={cn(
              "min-w-0 truncate",
              !selected && "text-muted-foreground",
            )}
          >
            {selected?.triggerLabel ?? selected?.label ?? placeholder}
          </span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-(--radix-popover-trigger-width) p-0",
          contentClassName,
        )}
      >
        <Command
          filter={(itemValue, search, keywords) => {
            const haystack = [itemValue, ...(keywords ?? [])]
              .join(" ")
              .toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label, option.keywords ?? ""]}
                  onSelect={(next) => {
                    onValueChange(next);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn(
                      "size-3.5 shrink-0",
                      option.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  {option.meta !== undefined && (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {option.meta}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
