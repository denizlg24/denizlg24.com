"use client";

import { DropdownMenu } from "radix-ui";
import {
  BarChart3,
  CandlestickChart,
  Check,
  ChartCandlestick,
  ChartLine,
  ChartNoAxesCombined,
  ChevronDown,
  Layers,
  type LucideIcon,
} from "lucide-react";
import {
  chartStyleLabels,
  chartStyles,
  type ChartPreferences,
  type ChartStyle,
} from "@/lib/models";
import { studies, studyInfo, type StudyKey } from "@/lib/indicators";
import { studyColors } from "./price-chart";

const styleIcons: Record<ChartStyle, LucideIcon> = {
  line: ChartLine,
  area: ChartNoAxesCombined,
  candles: ChartCandlestick,
  hollow: CandlestickChart,
  bars: BarChart3,
  heikin: ChartCandlestick,
};

export function StylePicker({
  value,
  onChange,
}: {
  value: ChartStyle;
  onChange: (style: ChartStyle) => void;
}) {
  const Icon = styleIcons[value];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="chip chip-menu" title="Chart type">
          <Icon aria-hidden size={14} />
          <span>{chartStyleLabels[value]}</span>
          <ChevronDown aria-hidden size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu-content"
          align="start"
          sideOffset={4}
        >
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const style = chartStyles.find((item) => item === next);
              if (style) onChange(style);
            }}
          >
            {chartStyles.map((style) => {
              const ItemIcon = styleIcons[style];
              return (
                <DropdownMenu.RadioItem
                  key={style}
                  value={style}
                  className="menu-item"
                >
                  <ItemIcon aria-hidden />
                  {chartStyleLabels[style]}
                  <DropdownMenu.ItemIndicator className="menu-check">
                    <Check size={13} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const groups = [...new Set(studies.map((item) => item.group))];
const MAX_STUDIES = 12;

export function StudyPicker({
  value,
  onChange,
}: {
  value: StudyKey[];
  onChange: (studies: StudyKey[]) => void;
}) {
  const toggle = (key: StudyKey) =>
    onChange(
      value.includes(key)
        ? value.filter((item) => item !== key)
        : [...value, key].slice(-MAX_STUDIES),
    );
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="chip chip-menu"
          title="Studies and indicators"
        >
          <Layers aria-hidden size={14} />
          <span>Studies{value.length ? ` · ${value.length}` : ""}</span>
          <ChevronDown aria-hidden size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu-content study-menu"
          align="end"
          sideOffset={4}
        >
          {groups.map((group, index) => (
            <DropdownMenu.Group key={group}>
              {index ? (
                <DropdownMenu.Separator className="menu-separator" />
              ) : null}
              <DropdownMenu.Label className="menu-label study-group">
                {group}
              </DropdownMenu.Label>
              {studies
                .filter((item) => item.group === group)
                .map((item) => (
                  <DropdownMenu.CheckboxItem
                    key={item.key}
                    className="menu-item study-item"
                    checked={value.includes(item.key)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggle(item.key)}
                    title={item.description}
                  >
                    <i
                      className="study-swatch"
                      style={{
                        background:
                          studyColors[item.key] ?? "var(--muted-foreground)",
                      }}
                      aria-hidden
                    />
                    <span>{item.label}</span>
                    <small>{item.pane === "price" ? "overlay" : "pane"}</small>
                    <DropdownMenu.ItemIndicator className="menu-check">
                      <Check size={13} />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.CheckboxItem>
                ))}
            </DropdownMenu.Group>
          ))}
          {value.length ? (
            <>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item
                className="menu-item"
                onSelect={() => onChange([])}
              >
                Clear all studies
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function StudyChips({
  value,
  onRemove,
}: {
  value: StudyKey[];
  onRemove: (key: StudyKey) => void;
}) {
  if (!value.length) return null;
  return (
    <ul className="study-chips" aria-label="Active studies">
      {value.map((key) => (
        <li key={key}>
          <button
            type="button"
            title={`Remove ${studyInfo.get(key)?.label}`}
            onClick={() => onRemove(key)}
          >
            <i
              className="study-swatch"
              style={{
                background: studyColors[key] ?? "var(--muted-foreground)",
              }}
              aria-hidden
            />
            {studyInfo.get(key)?.short}
            <span aria-hidden>×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export const samePreferences = (a: ChartPreferences, b: ChartPreferences) =>
  a.style === b.style &&
  a.range === b.range &&
  a.log === b.log &&
  a.studies.join() === b.studies.join();
