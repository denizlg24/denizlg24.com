"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface TagSelectProps {
  tags: string[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  title?: string;
  selectedLabel?: (count: number) => string;
  buttonClassName?: string;
}

export function TagSelect({
  tags,
  values,
  onChange,
  placeholder = "Filter by topic...",
  searchPlaceholder = "Search topic...",
  emptyText = "No topic found.",
  title = "Filter by topic",
  selectedLabel,
  buttonClassName,
}: TagSelectProps) {
  const [open, setOpen] = React.useState(false);
  const isMobile = useIsMobile();

  const label =
    values.length > 0
      ? (selectedLabel?.(values.length) ?? `${values.length} topic(s) selected`)
      : placeholder;

  const handleSelect = (currentValue: string) => {
    const included = values.includes(currentValue);
    const nextValues = included
      ? values.filter((value) => value !== currentValue)
      : [...values, currentValue];
    onChange(nextValues);
    setOpen(false);
  };

  const commandList = (listClassName?: string) => (
    <Command>
      <CommandInput placeholder={searchPlaceholder} className="h-9" />
      <CommandList className={listClassName}>
        <CommandEmpty>{emptyText}</CommandEmpty>
        <CommandGroup>
          {tags.map((tag) => (
            <CommandItem key={tag} value={tag} onSelect={handleSelect}>
              {tag}
              <Check
                className={cn(
                  "ml-auto",
                  values.includes(tag) ? "opacity-100" : "opacity-0",
                )}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  const triggerButton = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={cn("w-full justify-between", buttonClassName)}
    >
      {label}
      <ChevronsUpDown className="opacity-50" />
    </Button>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-4">
            {commandList("max-h-[60vh] overflow-y-auto")}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        className="w-[--radix-popover-trigger-width] max-w-[--radix-popover-trigger-width] p-0"
      >
        {commandList()}
      </PopoverContent>
    </Popover>
  );
}
