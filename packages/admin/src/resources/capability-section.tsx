"use client";

import type { ICapability } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import type { LucideIcon } from "lucide-react";
import { Clock, Plus, Power, PowerOff, Trash2 } from "lucide-react";

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
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Capabilities
          {capabilities.length > 0 && (
            <span className="ml-1.5 font-mono text-muted-foreground/60">
              {capabilities.length}
            </span>
          )}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1 text-muted-foreground"
          onClick={onAdd}
        >
          <Plus className="size-3" /> Add
        </Button>
      </div>

      {capabilities.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 border border-dashed border-border/50 rounded-lg px-4 py-5 text-center">
          No capabilities configured.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {capabilities.map((cap) => {
            const Icon = CAPABILITY_ICONS[cap.type] ?? Clock;
            const isSelected = selectedId === cap._id;
            return (
              <div
                key={cap._id}
                className={`group flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                  isSelected
                    ? "border-border bg-muted/40"
                    : "border-transparent hover:bg-muted/30"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(cap)}
                onKeyDown={(e) => e.key === "Enter" && onSelect(cap)}
              >
                <Icon className="size-3.5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{cap.label}</p>
                    {cap.baseUrl && (
                      <span className="text-[10px] font-mono text-muted-foreground/70 truncate max-w-50">
                        {cap.baseUrl}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground/70 uppercase">
                    {cap.type}
                  </p>
                </div>
                <span
                  className={`size-1.5 rounded-full shrink-0 ${cap.isActive ? "bg-accent" : "bg-muted-foreground/30"}`}
                />
                <div
                  className="flex items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => onToggle(cap._id, !cap.isActive)}
                    aria-label={
                      cap.isActive ? "Disable capability" : "Enable capability"
                    }
                    className="p-1 rounded hover:bg-muted/50 text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                  >
                    {cap.isActive ? (
                      <PowerOff className="size-3" />
                    ) : (
                      <Power className="size-3" />
                    )}
                  </button>
                  <button
                    onClick={() => onDelete(cap._id)}
                    aria-label="Delete capability"
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground/70 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
