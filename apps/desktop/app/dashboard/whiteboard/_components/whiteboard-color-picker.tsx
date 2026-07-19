"use client";

import { Button } from "@repo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { WHITEBOARD_COLOR_PALETTE } from "@repo/whiteboard-render";
import { Ban } from "lucide-react";
import { cn } from "@/lib/utils";

interface ColorFieldProps {
  value: string;
  onChange: (color: string) => void;
  recents?: string[];
  allowNone?: boolean;
  triggerClassName?: string;
  title?: string;
}

export function ColorField({
  value,
  onChange,
  recents = [],
  allowNone = false,
  triggerClassName,
  title,
}: ColorFieldProps) {
  const isNone = value === "none" || value === "";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon-sm"
          variant="outline"
          title={title}
          className={triggerClassName}
        >
          {isNone ? (
            <Ban className="size-3.5 text-muted-foreground" />
          ) : (
            <span
              className="size-4 rounded-full border border-border/60"
              style={{ backgroundColor: value }}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-fit! p-2 z-99! flex flex-col gap-2"
      >
        <div className="grid grid-cols-6 gap-1.5">
          {allowNone && (
            <button
              type="button"
              title="No fill"
              onClick={() => onChange("none")}
              className={cn(
                "size-5 rounded-full border flex items-center justify-center hover:border-primary transition-colors",
                isNone ? "border-primary" : "border-border/60",
              )}
            >
              <Ban className="size-3 text-muted-foreground" />
            </button>
          )}
          {WHITEBOARD_COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              onClick={() => onChange(color)}
              className={cn(
                "size-5 rounded-full border transition-transform hover:scale-110",
                value.toLowerCase() === color.toLowerCase()
                  ? "border-primary ring-1 ring-primary/40"
                  : "border-border/40",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        {recents.length > 0 && (
          <div className="flex flex-row items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Recent</span>
            {recents.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => onChange(color)}
                className="size-4 rounded-full border border-border/40 hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="color"
            value={isNone ? "#000000" : value}
            onChange={(e) => onChange(e.target.value)}
            className="size-6 rounded cursor-pointer bg-transparent"
          />
          Custom
        </label>
      </PopoverContent>
    </Popover>
  );
}
