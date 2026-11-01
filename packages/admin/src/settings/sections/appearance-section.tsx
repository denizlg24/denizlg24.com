"use client";

import {
  activeThemeId,
  type ModuleCustomization,
  type Theme,
  UI_DENSITIES,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Input } from "@repo/ui/input";
import { SegmentedControl } from "@repo/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Slider } from "@repo/ui/slider";
import { cn } from "@repo/ui/utils";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarRange,
  Copy,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAdmin } from "../../provider";
import {
  findTheme,
  localDay,
  useAppearanceStore,
} from "../../workspace/appearance/store";
import { ThemeEditor } from "../../workspace/appearance/theme-editor";
import { MODULE_SECTIONS } from "../../workspace/modules";
import { AppIcon, IconPicker } from "../../workspace/page-icon";
import { workspaceNav } from "../../workspace/refs";
import { SettingsGroup, SettingsRow } from "../settings-shell";

function Swatches({ theme }: { theme: Theme }) {
  const c = theme.colors;
  return (
    <span
      className="flex h-6 w-16 shrink-0 overflow-hidden rounded-md border border-border"
      style={{ background: c.background }}
    >
      {[c.surface, c.muted, c.accent, c.accentStrong].map((color, index) => (
        <span
          key={index}
          className="h-full flex-1"
          style={{ background: color }}
        />
      ))}
    </span>
  );
}

function ThemesGroup() {
  const themes = useAppearanceStore((s) => s.themes);
  const appearance = useAppearanceStore((s) => s.appearance);
  const patch = useAppearanceStore((s) => s.patch);
  const deleteTheme = useAppearanceStore((s) => s.deleteTheme);
  const [editing, setEditing] = useState<{
    theme: Theme | null;
    base: Theme;
  } | null>(null);
  const today = localDay();
  const on = activeThemeId(appearance, today);
  const current = findTheme(themes, on);

  return (
    <SettingsGroup
      label="Themes"
      actions={
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setEditing({ theme: null, base: current })}
        >
          <Plus /> New
        </Button>
      }
    >
      <div className="flex flex-col divide-y divide-border">
        {themes.map((theme) => {
          const isDefault = appearance.themeId === theme.id;
          const isOn = on === theme.id;
          const byAgent = theme.createdBy !== "owner";
          return (
            <div key={theme.id} className="group flex items-center gap-3 py-2">
              <Swatches theme={theme} />
              <button
                type="button"
                onClick={() => void patch({ themeId: theme.id })}
                className="flex min-w-0 flex-1 flex-col text-left"
              >
                <span className="flex items-center gap-1.5 text-sm text-accent-strong">
                  {theme.name}
                  {byAgent ? (
                    <Bot
                      className="size-3 text-muted-foreground"
                      aria-label={theme.createdBy}
                    />
                  ) : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {[
                    theme.scheme,
                    theme.effect.kind !== "none" ? theme.effect.kind : null,
                    theme.description || null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
              {isOn ? (
                <span className="text-[11px] font-medium text-accent-strong">
                  on
                </span>
              ) : isDefault ? (
                <span className="text-[11px] text-muted-foreground">
                  default
                </span>
              ) : null}
              <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy"
                  onClick={() => setEditing({ theme: null, base: theme })}
                >
                  <Copy />
                </Button>
                {theme.builtin ? null : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Edit"
                      onClick={() => setEditing({ theme, base: theme })}
                    >
                      <Pencil />
                    </Button>
                    <ConfirmButton
                      title={`Delete ${theme.name}?`}
                      actionLabel="Delete"
                      destructive
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete"
                        >
                          <Trash2 />
                        </Button>
                      }
                      onConfirm={() => deleteTheme(theme.id)}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {editing ? (
        <ThemeEditor
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          theme={editing.theme}
          base={editing.base}
        />
      ) : null}
    </SettingsGroup>
  );
}

function ScheduleGroup() {
  const themes = useAppearanceStore((s) => s.themes);
  const schedule = useAppearanceStore((s) => s.appearance.schedule);
  const addSchedule = useAppearanceStore((s) => s.addSchedule);
  const removeSchedule = useAppearanceStore((s) => s.removeSchedule);
  const today = localDay();
  const [themeId, setThemeId] = useState(themes[0]?.id ?? "");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [label, setLabel] = useState("");
  const sorted = [...schedule].sort((a, b) => a.from.localeCompare(b.from));

  return (
    <SettingsGroup label="Schedule">
      {sorted.length ? (
        <div className="flex flex-col divide-y divide-border">
          {sorted.map((entry) => {
            const live = entry.from <= today && today <= entry.to;
            const past = entry.to < today;
            return (
              <div
                key={entry.id}
                className={cn(
                  "group flex items-center gap-3 py-2 text-sm",
                  past && "opacity-50",
                )}
              >
                <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-accent-strong">
                  {findTheme(themes, entry.themeId).name}
                </span>
                {entry.label ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.label}
                  </span>
                ) : null}
                <span className="ml-auto tabular-nums text-xs text-muted-foreground">
                  {entry.from} → {entry.to}
                </span>
                {live ? (
                  <span className="text-[11px] font-medium text-accent-strong">
                    on
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => void removeSchedule(entry.id)}
                >
                  <X />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_8.5rem_8.5rem_1fr_auto]">
        <Select value={themeId} onValueChange={setThemeId}>
          <SelectTrigger aria-label="Theme" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {themes.map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                {theme.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          aria-label="From"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className="h-8 text-xs"
        />
        <Input
          type="date"
          aria-label="To"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="h-8 text-xs"
        />
        <Input
          aria-label="Label"
          placeholder="Label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="h-8 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!themeId || !from || !to || from > to}
          onClick={() => {
            void addSchedule({ themeId, from, to, label });
            setLabel("");
          }}
        >
          <Plus /> Add
        </Button>
      </div>
    </SettingsGroup>
  );
}

function TextGroup() {
  const textScale = useAppearanceStore((s) => s.appearance.textScale);
  const density = useAppearanceStore((s) => s.appearance.density);
  const patch = useAppearanceStore((s) => s.patch);
  const [scale, setScale] = useState<number | null>(null);
  return (
    <SettingsGroup label="Text and spacing">
      <SettingsRow
        label="Text size"
        hint={`${Math.round((scale ?? textScale) * 100)}%`}
      >
        <Slider
          aria-label="Text size"
          min={0.8}
          max={1.3}
          step={0.025}
          value={[scale ?? textScale]}
          onValueChange={([value]) => setScale(value)}
          onValueCommit={([value]) => {
            setScale(null);
            void patch({ textScale: value });
          }}
        />
      </SettingsRow>
      <SettingsRow label="Density">
        <SegmentedControl
          ariaLabel="Density"
          value={density}
          className="w-full [&_button]:min-h-8 [&_button]:text-xs"
          options={UI_DENSITIES.map((value) => ({ value, label: value }))}
          onValueChange={(value) => void patch({ density: value })}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

function move<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function SidebarGroup() {
  const { routes } = useAdmin();
  const appearance = useAppearanceStore((s) => s.appearance);
  const patch = useAppearanceStore((s) => s.patch);
  const base = workspaceNav(routes);
  const [labels, setLabels] = useState<Record<string, string>>({});

  const sections = useMemo(() => {
    const rank = new Map(appearance.sectionOrder.map((id, i) => [id, i]));
    return [...MODULE_SECTIONS].sort(
      (a, b) =>
        (rank.get(a.id) ?? 100 + MODULE_SECTIONS.indexOf(a)) -
        (rank.get(b.id) ?? 100 + MODULE_SECTIONS.indexOf(b)),
    );
  }, [appearance.sectionOrder]);

  const ordered = useMemo(() => {
    const rank = new Map(appearance.moduleOrder.map((id, i) => [id, i]));
    return base.sidebarModules
      .map((m, i) => ({ m, i }))
      .sort(
        (a, b) =>
          (rank.get(a.m.id) ?? 1000 + a.i) - (rank.get(b.m.id) ?? 1000 + b.i),
      )
      .map(({ m }) => m);
  }, [base.sidebarModules, appearance.moduleOrder]);

  const customize = (id: string, next: ModuleCustomization) => {
    const modules = { ...appearance.modules };
    const cleaned: ModuleCustomization = {
      ...(next.label ? { label: next.label } : {}),
      ...(next.icon ? { icon: next.icon } : {}),
    };
    if (cleaned.label || cleaned.icon) modules[id] = cleaned;
    else delete modules[id];
    void patch({ modules });
  };

  const moveModule = (id: string, delta: -1 | 1) => {
    const ids = ordered.map((m) => m.id as string);
    const section = ordered.find((m) => m.id === id)?.section;
    const peers = ordered
      .filter((m) => m.section === section)
      .map((m) => m.id as string);
    const moved = move(peers, peers.indexOf(id), delta);
    let cursor = 0;
    const next = ids.map((mid) =>
      ordered.find((m) => m.id === mid)?.section === section
        ? moved[cursor++]
        : mid,
    );
    void patch({ moduleOrder: next });
  };

  const customized =
    Object.keys(appearance.modules).length > 0 ||
    appearance.moduleOrder.length > 0 ||
    appearance.sectionOrder.length > 0;

  return (
    <SettingsGroup
      label="Sidebar"
      actions={
        customized ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              void patch({ modules: {}, moduleOrder: [], sectionOrder: [] })
            }
          >
            <RotateCcw /> Reset
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {sections.map((section, sectionIndex) => {
          const modules = ordered.filter((m) => m.section === section.id);
          if (modules.length === 0) return null;
          return (
            <div key={section.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {section.label}
                </span>
                <span className="flex-1" />
                {([-1, 1] as const).map((delta) => (
                  <Button
                    key={delta}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={delta < 0 ? "Section up" : "Section down"}
                    disabled={
                      delta < 0
                        ? sectionIndex === 0
                        : sectionIndex === sections.length - 1
                    }
                    onClick={() =>
                      void patch({
                        sectionOrder: move(
                          sections.map((s) => s.id),
                          sectionIndex,
                          delta,
                        ),
                      })
                    }
                  >
                    {delta < 0 ? <ArrowUp /> : <ArrowDown />}
                  </Button>
                ))}
              </div>
              {modules.map((module, index) => {
                const custom = appearance.modules[module.id] ?? {};
                const Default = module.icon;
                return (
                  <div
                    key={module.id}
                    className="group flex items-center gap-2"
                  >
                    <IconPicker
                      value={custom.icon ?? null}
                      onChange={(icon) =>
                        customize(module.id, {
                          ...custom,
                          icon: icon ?? undefined,
                        })
                      }
                    >
                      <button
                        type="button"
                        aria-label="Icon"
                        className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-surface"
                      >
                        {custom.icon ? (
                          <AppIcon value={custom.icon} />
                        ) : (
                          <Default className="size-4 text-muted-foreground" />
                        )}
                      </button>
                    </IconPicker>
                    <input
                      aria-label={`${module.label} label`}
                      value={labels[module.id] ?? custom.label ?? ""}
                      placeholder={module.label}
                      onChange={(event) =>
                        setLabels({
                          ...labels,
                          [module.id]: event.target.value,
                        })
                      }
                      onBlur={() => {
                        const value = labels[module.id];
                        if (value === undefined) return;
                        customize(module.id, {
                          ...custom,
                          label: value.trim() || undefined,
                        });
                        const { [module.id]: _done, ...rest } = labels;
                        setLabels(rest);
                      }}
                      className="h-7 min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm outline-none placeholder:text-foreground focus:bg-surface"
                    />
                    <div className="flex opacity-0 group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Up"
                        disabled={index === 0}
                        onClick={() => moveModule(module.id, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Down"
                        disabled={index === modules.length - 1}
                        onClick={() => moveModule(module.id, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </SettingsGroup>
  );
}

export function AppearanceSection() {
  return (
    <>
      <ThemesGroup />
      <ScheduleGroup />
      <TextGroup />
      <SidebarGroup />
    </>
  );
}
