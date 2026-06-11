"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  Archive,
  ArrowRight,
  Bookmark,
  Bug,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Code2,
  Eye,
  Flag,
  Flame,
  Folder,
  Heart,
  Inbox,
  Layers,
  Lightbulb,
  ListTodo,
  Loader,
  MessageSquare,
  Milestone,
  Pencil,
  Play,
  Rocket,
  Search,
  Settings,
  Shield,
  Sparkles,
  Star,
  Target,
  TestTube,
  Truck,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export const COLUMN_ICON_MAP: Record<string, LucideIcon> = {
  circle: Circle,
  clock: Clock,
  inbox: Inbox,
  "list-todo": ListTodo,
  loader: Loader,
  play: Play,
  "arrow-right": ArrowRight,
  pencil: Pencil,
  code: Code2,
  eye: Eye,
  search: Search,
  "test-tube": TestTube,
  "check-circle": CheckCircle2,
  check: Check,
  rocket: Rocket,
  flag: Flag,
  milestone: Milestone,
  target: Target,
  star: Star,
  sparkles: Sparkles,
  zap: Zap,
  flame: Flame,
  lightbulb: Lightbulb,
  bug: Bug,
  shield: Shield,
  "alert-circle": AlertCircle,
  "x-circle": XCircle,
  heart: Heart,
  bookmark: Bookmark,
  "message-square": MessageSquare,
  calendar: Calendar,
  archive: Archive,
  folder: Folder,
  layers: Layers,
  settings: Settings,
  truck: Truck,
};

export const COLUMN_ICON_NAMES = Object.keys(COLUMN_ICON_MAP);

export const COLUMN_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#64748b",
];

export function resolveColumnIcon(iconName?: string): LucideIcon {
  if (iconName && iconName in COLUMN_ICON_MAP) {
    return COLUMN_ICON_MAP[iconName];
  }
  return Circle;
}

export function ColumnColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {COLUMN_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`size-7 rounded-full border-2 transition-all hover:scale-110 ${
            value === c ? "border-foreground scale-110" : "border-transparent"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

export function ColumnIconPicker({
  value,
  onChange,
  color,
}: {
  value: string;
  onChange: (icon: string) => void;
  color?: string;
}) {
  const [filter, setFilter] = useState("");

  const filtered = COLUMN_ICON_NAMES.filter((name) =>
    name.includes(filter.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="Search icons…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="h-7 text-xs"
      />
      <ScrollArea className="h-36">
        <div className="grid grid-cols-6 gap-2 p-1">
          {filtered.map((name) => {
            const Icon = COLUMN_ICON_MAP[name];
            const selected = value === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => onChange(name)}
                className={`size-8 rounded-md flex items-center justify-center transition-colors ${
                  selected
                    ? "bg-primary/15 text-primary ring-1 ring-primary/50"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title={name}
              >
                <Icon
                  className="size-4"
                  style={selected ? { color: color || undefined } : undefined}
                />
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
