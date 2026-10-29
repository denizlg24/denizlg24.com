"use client";

import { Button } from "@repo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { cn } from "@repo/ui/utils";
import { FileText } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ResolvedRef } from "@/lib/workspace/refs";

export function PageIcon({
  icon,
  className,
}: {
  icon: string | null;
  className?: string;
}) {
  if (icon) {
    return (
      <span
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center text-[13px] leading-none",
          className,
        )}
      >
        {icon}
      </span>
    );
  }
  return <FileText className={cn("size-4 shrink-0", className)} />;
}

export function RefIcon({
  resolved,
  className,
}: {
  resolved: ResolvedRef;
  className?: string;
}) {
  if (resolved.kind === "page") {
    return <PageIcon icon={resolved.page.icon} className={className} />;
  }
  const Icon = resolved.module.icon;
  return <Icon className={cn("size-4 shrink-0", className)} />;
}

const EMOJI = [
  "🌿",
  "🏠",
  "📌",
  "⭐",
  "🔥",
  "✨",
  "🎯",
  "🧭",
  "🗂️",
  "📁",
  "📝",
  "📓",
  "📚",
  "📖",
  "🧠",
  "💡",
  "🔬",
  "🧪",
  "🎓",
  "🏫",
  "💶",
  "💰",
  "📈",
  "📊",
  "🧾",
  "🏦",
  "🛒",
  "🍳",
  "🥗",
  "🏃",
  "💪",
  "🧘",
  "❤️",
  "🌱",
  "🌍",
  "✈️",
  "🗺️",
  "🏔️",
  "🌊",
  "☀️",
  "🌙",
  "⏰",
  "📅",
  "🗓️",
  "✅",
  "☑️",
  "🚀",
  "🛰️",
  "🖥️",
  "💻",
  "⚙️",
  "🔧",
  "🛠️",
  "🔒",
  "🔑",
  "📡",
  "🧩",
  "🎨",
  "🎵",
  "🎬",
  "📷",
  "🎮",
  "👥",
  "🤝",
  "💬",
  "📬",
  "📮",
  "🗞️",
  "🏷️",
  "🔖",
];

/** Click the icon to change it: a curated emoji grid plus Remove. */
export function IconPicker({
  value,
  onChange,
  children,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[19rem] p-2">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Icon
          </span>
          {value ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-10 gap-0.5">
          {EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onChange(emoji);
                setOpen(false);
              }}
              className={cn(
                "flex size-7 items-center justify-center rounded-md text-base transition-colors hover:bg-surface",
                value === emoji && "bg-surface",
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
