"use client";

import type { ICapability } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import { Switch } from "@repo/ui/switch";
import { RowActions } from "@repo/ui/toolbar";
import type { LucideIcon } from "lucide-react";
import { Clock, Plus, Puzzle, Trash2 } from "lucide-react";

const CAPABILITY_ICONS: Record<string, LucideIcon> = {
  picron: Clock,
};

export function CapabilitySection({
  capabilities,
  onAdd,
  onToggle,
  onDelete,
  onSelect,
  selectedId,
}: {
  capabilities: ICapability[];
  onAdd: () => void;
  onToggle: (capId: string, isActive: boolean) => void;
  onDelete: (capId: string) => void;
  onSelect: (cap: ICapability) => void;
  selectedId?: string | null;
}) {
  return (
    <Section
      title="Capabilities"
      count={capabilities.length > 0 ? capabilities.length : undefined}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add capability"
          onClick={onAdd}
        >
          <Plus />
        </Button>
      }
    >
      {capabilities.length === 0 ? (
        <EmptyState compact icon={<Puzzle />} label="No capabilities" />
      ) : (
        <List>
          {capabilities.map((cap) => {
            const Icon = CAPABILITY_ICONS[cap.type] ?? Puzzle;
            return (
              <ListRow
                key={cap._id}
                selected={selectedId === cap._id}
                onClick={() => onSelect(cap)}
                leading={<Icon />}
                title={cap.label}
                description={
                  <span className="font-mono">
                    {cap.type}
                    {cap.baseUrl ? ` · ${cap.baseUrl}` : ""}
                  </span>
                }
                trailing={
                  // Switch and menu clicks must not also select the row.
                  <span
                    className="flex items-center gap-1"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Switch
                      checked={cap.isActive}
                      onCheckedChange={(checked) => onToggle(cap._id, checked)}
                      aria-label={`${cap.label} active`}
                    />
                    <RowActions>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onDelete(cap._id)}
                      >
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </RowActions>
                  </span>
                }
              />
            );
          })}
        </List>
      )}
    </Section>
  );
}
