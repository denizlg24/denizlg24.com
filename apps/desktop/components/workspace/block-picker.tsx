"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import { BLOCK_TYPES, type BlockType } from "@/lib/workspace/schema";
import { BLOCK_CATALOG, BLOCK_CATEGORIES } from "./block-catalog";

/** The "/" menu: every block type, grouped, searchable by name and keyword. */
export function BlockPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (type: BlockType) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        showCloseButton={false}
        className="top-[22%] translate-y-0 gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Add a block</DialogTitle>
        <Command>
          <CommandInput placeholder="Add a block" />
          <CommandList className="max-h-[min(60vh,26rem)]">
            <CommandEmpty>No block</CommandEmpty>
            {BLOCK_CATEGORIES.map((category) => (
              <CommandGroup key={category} heading={category}>
                {BLOCK_TYPES.filter(
                  (t) => BLOCK_CATALOG[t].category === category,
                ).map((type) => {
                  const meta = BLOCK_CATALOG[type];
                  const Icon = meta.icon;
                  return (
                    <CommandItem
                      key={type}
                      value={`${meta.label} ${meta.keywords?.join(" ") ?? ""}`}
                      onSelect={() => {
                        onPick(type);
                        onOpenChange(false);
                      }}
                    >
                      <Icon />
                      {meta.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
