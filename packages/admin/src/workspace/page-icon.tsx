"use client";

import {
  ICON_COLORS,
  type IconColor,
  iconValue,
  parseIconValue,
  REACT_ICON_SETS,
  type ReactIconSet,
  reactIconValue,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { cn } from "@repo/ui/utils";
import { FileText, icons, type LucideIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { REACT_ICON_SET_LABELS, useReactIconSet } from "./react-icons";
import type { ResolvedRef } from "./refs";

export const ICON_COLOR_CLASS: Record<IconColor, string> = {
  default: "",
  muted: "text-muted-foreground",
  accent: "text-accent",
  gray: "text-zinc-500",
  brown: "text-amber-800",
  orange: "text-orange-500",
  yellow: "text-yellow-500",
  green: "text-green-600",
  blue: "text-blue-600",
  purple: "text-purple-600",
  pink: "text-pink-500",
  red: "text-red-600",
};

const SWATCH_CLASS: Record<IconColor, string> = {
  default: "bg-foreground",
  muted: "bg-muted-foreground",
  accent: "bg-accent",
  gray: "bg-zinc-500",
  brown: "bg-amber-800",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green: "bg-green-600",
  blue: "bg-blue-600",
  purple: "bg-purple-600",
  pink: "bg-pink-500",
  red: "bg-red-600",
};

function pascal(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

const ICONS = icons as Record<string, LucideIcon>;

export function lucideIcon(name: string): LucideIcon | null {
  return ICONS[pascal(name)] ?? null;
}

/** Every icon name, kebab-case, computed once. */
let allNames: { name: string; key: string }[] | null = null;
function iconNames(): { name: string; key: string }[] {
  if (!allNames) {
    allNames = Object.keys(ICONS).map((key) => ({ name: kebab(key), key }));
  }
  return allNames;
}

/**
 * Renders an icon value: `icon:<lucide-name>[:color]` as that glyph, anything
 * else as text (pages written before icons hold emojis).
 */
export function AppIcon({
  value,
  className,
  fallback,
}: {
  value: string | null | undefined;
  className?: string;
  fallback?: LucideIcon;
}) {
  if (!value) {
    const Fallback = fallback ?? FileText;
    return <Fallback className={cn("size-4 shrink-0", className)} />;
  }
  const parsed = parseIconValue(value);
  if (parsed.kind === "react-icon") {
    return (
      <ReactIconGlyph
        set={parsed.set}
        name={parsed.name}
        className={cn(
          "size-4 shrink-0",
          className,
          ICON_COLOR_CLASS[parsed.color],
        )}
      />
    );
  }
  if (parsed.kind === "icon") {
    const Glyph = lucideIcon(parsed.name);
    if (Glyph) {
      return (
        <Glyph
          className={cn(
            "size-4 shrink-0",
            className,
            ICON_COLOR_CLASS[parsed.color],
          )}
        />
      );
    }
  }
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center text-[13px] leading-none",
        className,
      )}
    >
      {parsed.kind === "emoji" ? parsed.value : "?"}
    </span>
  );
}

/** A react-icons glyph; a blank square of the same size while its set loads. */
function ReactIconGlyph({
  set,
  name,
  className,
}: {
  set: ReactIconSet;
  name: string;
  className?: string;
}) {
  const icons = useReactIconSet(set);
  const Glyph = icons?.[name];
  if (!Glyph) return <span className={cn("inline-block", className)} />;
  return <Glyph className={className} />;
}

/** Search one react-icons set, loaded when the tab first shows it. */
function LibraryGrid({
  query,
  color,
  current,
  onPick,
}: {
  query: string;
  color: IconColor;
  current: { set: ReactIconSet; name: string } | null;
  onPick: (value: string) => void;
}) {
  const [set, setSet] = useState<ReactIconSet>(current?.set ?? "si");
  const icons = useReactIconSet(set);
  const names = useMemo(() => {
    if (!icons) return [];
    const q = query
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "");
    const matches: string[] = [];
    for (const name of Object.keys(icons)) {
      if (!q || name.toLowerCase().includes(q)) matches.push(name);
      if (matches.length >= RESULTS_MAX) break;
    }
    return matches;
  }, [icons, query]);
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-1">
        {REACT_ICON_SETS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setSet(option)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px]",
              set === option
                ? "bg-surface text-accent-strong"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {REACT_ICON_SET_LABELS[option]}
          </button>
        ))}
      </div>
      <div className="grid max-h-56 grid-cols-10 gap-0.5 overflow-y-auto">
        {icons
          ? names.map((name) => {
              const Glyph = icons[name];
              if (!Glyph) return null;
              const selected = current?.set === set && current.name === name;
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => onPick(reactIconValue(set, name, color))}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-surface",
                    selected && "bg-surface",
                  )}
                >
                  <Glyph className={cn("size-4", ICON_COLOR_CLASS[color])} />
                </button>
              );
            })
          : null}
      </div>
      {icons && names.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">—</p>
      ) : null}
    </>
  );
}

export function PageIcon({
  icon,
  className,
}: {
  icon: string | null;
  className?: string;
}) {
  return <AppIcon value={icon} className={className} />;
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

const SUGGESTED = [
  "file-text",
  "house",
  "pin",
  "star",
  "flame",
  "sparkles",
  "target",
  "compass",
  "folder",
  "notebook-pen",
  "book-open",
  "library",
  "brain",
  "lightbulb",
  "flask-conical",
  "graduation-cap",
  "school",
  "wallet",
  "piggy-bank",
  "chart-line",
  "chart-column",
  "receipt",
  "landmark",
  "shopping-cart",
  "chef-hat",
  "salad",
  "dumbbell",
  "heart-pulse",
  "heart",
  "sprout",
  "earth",
  "plane",
  "map",
  "mountain",
  "waves",
  "sun",
  "moon",
  "alarm-clock",
  "calendar",
  "calendar-days",
  "circle-check",
  "list-todo",
  "rocket",
  "satellite",
  "monitor",
  "laptop",
  "settings",
  "wrench",
  "hammer",
  "lock",
  "key-round",
  "radio",
  "puzzle",
  "palette",
  "music",
  "clapperboard",
  "camera",
  "gamepad-2",
  "users",
  "handshake",
  "message-circle",
  "mail",
  "inbox",
  "newspaper",
  "tag",
  "bookmark",
  "code",
  "terminal",
  "database",
  "server",
  "cloud",
  "gift",
  "tree-pine",
  "snowflake",
  "leaf",
  "flower-2",
  "coffee",
  "briefcase",
  "trophy",
  "zap",
];

const EMOJI = [
  "🌿",
  "🏠",
  "📌",
  "⭐",
  "🔥",
  "✨",
  "🎯",
  "📝",
  "📚",
  "🧠",
  "💡",
  "🎓",
  "💰",
  "📈",
  "🍳",
  "💪",
  "❤️",
  "🌍",
  "✈️",
  "☀️",
  "🌙",
  "📅",
  "✅",
  "🚀",
  "💻",
  "⚙️",
  "🔒",
  "🎨",
  "🎵",
  "🎄",
];

const RESULTS_MAX = 240;

/** Icon grid with search and a colour, plus a short emoji tab. */
export function IconPicker({
  value,
  onChange,
  children,
  removable = true,
}: {
  value: string | null;
  onChange: (icon: string | null) => void;
  children: ReactNode;
  removable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = value ? parseIconValue(value) : null;
  const [tab, setTab] = useState<"icons" | "libraries" | "emoji">(
    current?.kind === "react-icon" ? "libraries" : "icons",
  );
  const [color, setColor] = useState<IconColor>(
    current && current.kind !== "emoji" ? current.color : "default",
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "-");
    if (!q) return SUGGESTED.filter((name) => lucideIcon(name));
    const matches: string[] = [];
    for (const { name } of iconNames()) {
      if (name.includes(q)) matches.push(name);
      if (matches.length >= RESULTS_MAX) break;
    }
    return matches;
  }, [query]);

  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[21rem] p-2">
        <div className="mb-2 flex items-center gap-1 px-1">
          {(["icons", "libraries", "emoji"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em]",
                tab === t
                  ? "bg-surface text-accent-strong"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
          <span className="flex-1" />
          {value && removable ? (
            <Button variant="ghost" size="xs" onClick={() => pick(null)}>
              Remove
            </Button>
          ) : null}
        </div>
        {tab !== "emoji" ? (
          <>
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search icons"
              className="mb-2 h-8 text-sm"
            />
            <div className="mb-2 flex flex-wrap gap-1 px-0.5">
              {ICON_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  title={c}
                  onClick={() => {
                    setColor(c);
                    if (current?.kind === "icon") {
                      onChange(iconValue(current.name, c));
                    } else if (current?.kind === "react-icon") {
                      onChange(reactIconValue(current.set, current.name, c));
                    }
                  }}
                  className={cn(
                    "size-4 rounded-full ring-offset-1 ring-offset-background",
                    SWATCH_CLASS[c],
                    color === c && "ring-2 ring-ring",
                  )}
                />
              ))}
            </div>
            {tab === "libraries" ? (
              <LibraryGrid
                query={query}
                color={color}
                current={current?.kind === "react-icon" ? current : null}
                onPick={pick}
              />
            ) : (
              <>
                <div className="grid max-h-64 grid-cols-10 gap-0.5 overflow-y-auto">
                  {results.map((name) => {
                    const Glyph = lucideIcon(name);
                    if (!Glyph) return null;
                    const selected =
                      current?.kind === "icon" && current.name === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        title={name}
                        onClick={() => pick(iconValue(name, color))}
                        className={cn(
                          "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-surface",
                          selected && "bg-surface",
                        )}
                      >
                        <Glyph
                          className={cn("size-4", ICON_COLOR_CLASS[color])}
                        />
                      </button>
                    );
                  })}
                </div>
                {results.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-muted-foreground">—</p>
                ) : null}
              </>
            )}
          </>
        ) : (
          <div className="grid grid-cols-10 gap-0.5">
            {EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => pick(emoji)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-base transition-colors hover:bg-surface",
                  value === emoji && "bg-surface",
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
