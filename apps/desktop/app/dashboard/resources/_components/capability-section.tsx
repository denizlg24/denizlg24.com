"use client";

import type { LucideIcon } from "lucide-react";
import { Clock, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ICapability } from "@/lib/data-types";

const CAPABILITY_ICONS: Record<string, LucideIcon> = {
  picron: Clock,
};

export function CapabilitySection({
  capabilities,
  onAdd,
  onToggle,
  onDelete,
  onSelect,
}: {
  capabilities: ICapability[];
  onAdd: () => void;
  onToggle: (capId: string, isActive: boolean) => void;
  onDelete: (capId: string) => void;
  onSelect: (cap: ICapability) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Capabilities
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
        <p className="text-xs text-muted-foreground py-4 text-center">
          No capabilities configured
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {capabilities.map((cap) => (
            <div
              key={cap._id}
              className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/30 transition-colors cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={() => onSelect(cap)}
              onKeyDown={(e) => e.key === "Enter" && onSelect(cap)}
            >
              {(() => {
                const Icon = CAPABILITY_ICONS[cap.type];
                return Icon ? (
                  <Icon className="size-3.5 text-muted-foreground" />
                ) : (
                  <Clock className="size-3.5 text-muted-foreground" />
                );
              })()}
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
                className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => onToggle(cap._id, !cap.isActive)}
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
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground/70 hover:text-destructive transition-colors"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
