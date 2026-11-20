"use client";

import { useState, type FormEvent } from "react";
import { DropdownMenu, Popover } from "radix-ui";
import {
  Activity,
  Baseline,
  BellPlus,
  ChevronDown,
  Download,
  Eraser,
  GitCompareArrows,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  MousePointer2,
  MoveHorizontal,
  MoveVertical,
  Paintbrush,
  Ruler,
  Spline,
  Square,
  TrendingUp,
  Type,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  averageKinds,
  chartScales,
  oscillatorKinds,
  type ChartAppearance,
  type ChartScale,
  type ChartTemplate,
  type CustomAverage,
  type CustomPane,
  type OscillatorKind,
} from "@/lib/models";
import {
  averageLabel,
  drawingPalette,
  paneLabel,
  toolLabels,
} from "@/lib/chart-studio";
import { symbolPattern } from "@/lib/universes";
import type { Tool } from "./drawing-layer";
import { ConfirmDialog, PromptDialog } from "@/components/ui/prompt-dialog";

const tools: { tool: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { tool: "cursor", icon: MousePointer2, label: "Cursor: drag to pan, wheel to zoom", key: "Esc" },
  { tool: "trend", icon: TrendingUp, label: toolLabels.trend, key: "T" },
  { tool: "ray", icon: Spline, label: toolLabels.ray, key: "R" },
  { tool: "hline", icon: MoveHorizontal, label: toolLabels.hline, key: "H" },
  { tool: "vline", icon: MoveVertical, label: toolLabels.vline, key: "V" },
  { tool: "rect", icon: Square, label: toolLabels.rect, key: "B" },
  { tool: "fib", icon: Baseline, label: toolLabels.fib, key: "F" },
  { tool: "channel", icon: Waves, label: toolLabels.channel, key: "C" },
  { tool: "text", icon: Type, label: toolLabels.text, key: "N" },
  { tool: "measure", icon: Ruler, label: "Measure", key: "M" },
  { tool: "alert", icon: BellPlus, label: "Set a price alert at a level", key: "A" },
  { tool: "erase", icon: Eraser, label: "Erase: click a drawing", key: "E" },
];
export const toolShortcuts = new Map(
  tools.map((item) => [item.key.toLowerCase(), item.tool]),
);

export function DrawingTools({
  tool,
  setTool,
  color,
  setColor,
  count,
  clear,
}: {
  tool: Tool;
  setTool: (tool: Tool) => void;
  color: string;
  setColor: (color: string) => void;
  count: number;
  clear: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="studio-tools" role="toolbar" aria-label="Drawing tools">
      {confirming ? (
        <ConfirmDialog
          title={`Remove ${count} drawing${count === 1 ? "" : "s"}?`}
          description="Every drawing on this symbol is deleted from your workspace. This can't be undone."
          confirmLabel="Remove all"
          destructive
          onConfirm={clear}
          onClose={() => setConfirming(false)}
        />
      ) : null}
      {tools.map((item) => (
        <button
          key={item.tool}
          type="button"
          aria-pressed={tool === item.tool}
          title={`${item.label} (${item.key === "Esc" ? "Esc" : `⇧${item.key}`})`}
          aria-label={item.label}
          onClick={() => setTool(tool === item.tool ? "cursor" : item.tool)}
        >
          <item.icon size={14} aria-hidden />
        </button>
      ))}
      <span className="studio-divider" aria-hidden />
      {drawingPalette.map((swatch) => (
        <button
          key={swatch}
          type="button"
          className="studio-swatch"
          aria-pressed={color === swatch}
          aria-label={`Drawing colour ${swatch}`}
          style={{ background: swatch }}
          onClick={() => setColor(swatch)}
        />
      ))}
      {count ? (
        <button
          type="button"
          className="studio-clear"
          title="Remove every drawing on this symbol"
          onClick={() => setConfirming(true)}
        >
          Clear {count}
        </button>
      ) : null}
    </div>
  );
}

const scaleLabels: Record<ChartScale, string> = {
  linear: "Lin",
  log: "Log",
  percent: "%",
};

export function ScalePicker({
  value,
  onChange,
}: {
  value: ChartScale;
  onChange: (scale: ChartScale) => void;
}) {
  return (
    <div className="seg seg-tight" role="group" aria-label="Price scale">
      {chartScales.map((scale) => (
        <button
          key={scale}
          type="button"
          aria-pressed={value === scale}
          title={
            scale === "percent"
              ? "Percent change from the first visible bar"
              : scale === "log"
                ? "Logarithmic scale"
                : "Linear scale"
          }
          onClick={() => onChange(scale)}
        >
          {scaleLabels[scale]}
        </button>
      ))}
    </div>
  );
}

export const compareColors = ["#3f8fd8", "#d0503c", "#a565c9", "#3aa776"];

export function CompareControl({
  ticker,
  value,
  onChange,
}: {
  ticker: string;
  value: string[];
  onChange: (symbols: string[]) => void;
}) {
  const [text, setText] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const symbols = text
      .toUpperCase()
      .split(/[\s,]+/)
      .filter((item) => symbolPattern.test(item) && item !== ticker);
    if (symbols.length)
      onChange([...new Set([...value, ...symbols])].slice(0, compareColors.length));
    setText("");
  }
  return (
    <div className="studio-compare">
      <form onSubmit={submit}>
        <GitCompareArrows size={13} aria-hidden />
        <label className="sr-only" htmlFor="compare-input">
          Compare with
        </label>
        <input
          id="compare-input"
          placeholder="vs SPY, QQQ"
          value={text}
          maxLength={60}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setText(event.target.value.toUpperCase())}
        />
      </form>
      {value.map((symbol, index) => (
        <button
          key={symbol}
          type="button"
          className="studio-tag"
          style={{ borderColor: compareColors[index] }}
          title={`Remove ${symbol}`}
          onClick={() => onChange(value.filter((item) => item !== symbol))}
        >
          <i style={{ background: compareColors[index] }} aria-hidden />
          {symbol}
          <X size={11} aria-hidden />
        </button>
      ))}
    </div>
  );
}

const averageColors = ["#e0a030", "#3f8fd8", "#d0503c", "#a565c9", "#3aa776", "#c9a227", "#23798a", "#8a6a00"];

export function AverageEditor({
  value,
  onChange,
}: {
  value: CustomAverage[];
  onChange: (averages: CustomAverage[]) => void;
}) {
  const [kind, setKind] = useState<CustomAverage["kind"]>("ema");
  const [period, setPeriod] = useState("34");
  const [source, setSource] = useState<CustomAverage["source"]>("close");
  const n = Number(period);
  const valid = Number.isInteger(n) && n >= 2 && n <= 500 && value.length < 8;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="chip chip-menu" title="Custom moving averages">
          <TrendingUp size={14} aria-hidden />
          <span>MAs{value.length ? ` · ${value.length}` : ""}</span>
          <ChevronDown size={12} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu-content studio-popover" align="end" sideOffset={4}>
          <h4>Custom moving averages</h4>
          {value.length ? (
            <ul className="studio-list">
              {value.map((average, index) => (
                <li key={`${averageLabel(average)}-${index}`}>
                  <input
                    type="color"
                    value={average.color}
                    aria-label={`Colour of ${averageLabel(average)}`}
                    onChange={(event) =>
                      onChange(
                        value.map((item, i) =>
                          i === index ? { ...item, color: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <span>{averageLabel(average)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${averageLabel(average)}`}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Any period, any type. Saved with your chart defaults.</p>
          )}
          <form
            className="studio-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!valid) return;
              onChange([
                ...value,
                {
                  kind,
                  period: n,
                  source,
                  color: averageColors[value.length % averageColors.length],
                },
              ]);
            }}
          >
            <select
              className="studio-select"
              value={kind}
              aria-label="Average type"
              onChange={(event) =>
                setKind(
                  averageKinds.find((item) => item === event.target.value) ?? "sma",
                )
              }
            >
              {averageKinds.map((item) => (
                <option key={item} value={item}>
                  {item.toUpperCase()}
                </option>
              ))}
            </select>
            <input
              className="studio-select"
              type="number"
              min={2}
              max={500}
              value={period}
              aria-label="Period"
              onChange={(event) => setPeriod(event.target.value)}
            />
            <select
              className="studio-select"
              value={source}
              aria-label="Price source"
              onChange={(event) => {
                const next = (["close", "hl2", "hlc3", "ohlc4"] as const).find(
                  (item) => item === event.target.value,
                );
                if (next) setSource(next);
              }}
            >
              <option value="close">Close</option>
              <option value="hl2">HL/2</option>
              <option value="hlc3">HLC/3</option>
              <option value="ohlc4">OHLC/4</option>
            </select>
            <button type="submit" className="chip" disabled={!valid}>
              Add
            </button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AppearanceMenu({
  value,
  onChange,
}: {
  value: ChartAppearance;
  onChange: (appearance: ChartAppearance) => void;
}) {
  const toggles: [keyof ChartAppearance, string][] = [
    ["grid", "Grid lines"],
    ["crosshair", "Crosshair"],
    ["lastPrice", "Last price line"],
    ["extremes", "High / low labels"],
    ["events", "Dividends and splits"],
    ["alerts", "Price alert levels"],
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="chip chip-menu" title="Chart appearance">
          <Paintbrush size={14} aria-hidden />
          <span>Style</span>
          <ChevronDown size={12} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu-content studio-popover" align="end" sideOffset={4}>
          <h4>Appearance</h4>
          {toggles.map(([key, label]) => (
            <label key={key} className="studio-check">
              <input
                type="checkbox"
                checked={Boolean(value[key])}
                onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
          <label className="studio-row">
            Line width
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.25}
              value={value.lineWidth}
              onChange={(event) =>
                onChange({ ...value, lineWidth: Number(event.target.value) })
              }
            />
            <span>{value.lineWidth.toFixed(2)}</span>
          </label>
          {(["up", "down"] as const).map((key) => (
            <label key={key} className="studio-row">
              {key === "up" ? "Up colour" : "Down colour"}
              <input
                type="color"
                value={value[key] ?? (key === "up" ? "#1b6e45" : "#b0342f")}
                onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              />
              {value[key] ? (
                <button type="button" className="chip" onClick={() => onChange({ ...value, [key]: null })}>
                  Theme
                </button>
              ) : (
                <span className="muted">theme</span>
              )}
            </label>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ExportMenu({
  onPng,
  onSvg,
  onCsv,
}: {
  onPng: () => void;
  onSvg: () => void;
  onCsv: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="chip" aria-label="Export chart" title="Export chart">
          <Download size={13} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu-content" align="end" sideOffset={4}>
          <DropdownMenu.Item className="menu-item" onSelect={onPng}>
            PNG image
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={onSvg}>
            SVG (price pane)
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={onCsv}>
            OHLCV data (CSV)
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function FullscreenToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const Icon = value ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={value}
      aria-label={value ? "Exit full screen" : "Full screen chart"}
      title={value ? "Exit full screen (Esc)" : "Full screen chart"}
      onClick={() => onChange(!value)}
    >
      <Icon size={13} aria-hidden />
    </button>
  );
}


export function TemplateMenu({
  templates,
  current,
  apply,
  save,
}: {
  templates: ChartTemplate[];
  current: Omit<ChartTemplate, "id" | "name">;
  apply: (template: ChartTemplate) => void;
  save: (next: ChartTemplate[]) => void;
}) {
  const [naming, setNaming] = useState(false);
  return (
    <>
      {naming ? (
        <PromptDialog
          title="Save chart template"
          description="Stores the chart type, studies, moving averages, panes, scale and style. Using an existing name replaces it."
          label="Name"
          placeholder="e.g. Swing setup"
          maxLength={60}
          onSubmit={(name) =>
            save(
              [
                ...templates.filter((item) => item.name !== name),
                { ...current, id: crypto.randomUUID(), name },
              ].slice(-30),
            )
          }
          onClose={() => setNaming(false)}
        />
      ) : null}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="chip chip-menu" title="Chart templates">
          <LayoutTemplate size={14} aria-hidden />
          <span>Templates{templates.length ? ` · ${templates.length}` : ""}</span>
          <ChevronDown size={12} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu-content" align="end" sideOffset={4}>
          {templates.map((template) => (
            <DropdownMenu.Item
              key={template.id}
              className="menu-item template-item"
              onSelect={() => apply(template)}
            >
              <span>{template.name}</span>
              <small>
                {template.studies.length + template.averages.length} studies · {template.scale}
              </small>
              <button
                type="button"
                className="template-delete"
                aria-label={`Delete template ${template.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  save(templates.filter((item) => item.id !== template.id));
                }}
              >
                <X size={12} />
              </button>
            </DropdownMenu.Item>
          ))}
          {templates.length ? <DropdownMenu.Separator className="menu-separator" /> : null}
          <DropdownMenu.Item
            className="menu-item"
            onSelect={() => setNaming(true)}
          >
            Save current chart as template…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    </>
  );
}

const paneColors = ["#a565c9", "#23798a", "#c9a227", "#d0503c"];

export function PaneEditor({
  value,
  onChange,
}: {
  value: CustomPane[];
  onChange: (panes: CustomPane[]) => void;
}) {
  const [kind, setKind] = useState<OscillatorKind>("rsi");
  const [period, setPeriod] = useState("21");
  const n = Number(period);
  const valid = Number.isInteger(n) && n >= 2 && n <= 500 && value.length < 4;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="chip chip-menu" title="Custom oscillator panes">
          <Activity size={14} aria-hidden />
          <span>Panes{value.length ? ` · ${value.length}` : ""}</span>
          <ChevronDown size={12} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu-content studio-popover" align="end" sideOffset={4}>
          <h4>Custom panes</h4>
          {value.length ? (
            <ul className="studio-list">
              {value.map((pane, index) => (
                <li key={`${paneLabel(pane)}-${index}`}>
                  <input
                    type="color"
                    value={pane.color}
                    aria-label={`Colour of ${paneLabel(pane)}`}
                    onChange={(event) =>
                      onChange(value.map((item, i) => (i === index ? { ...item, color: event.target.value } : item)))
                    }
                  />
                  <span>{paneLabel(pane)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${paneLabel(pane)}`}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Any oscillator, any period, each in its own pane. Up to four.</p>
          )}
          <form
            className="studio-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!valid) return;
              onChange([...value, { kind, period: n, color: paneColors[value.length % paneColors.length] }]);
            }}
          >
            <select
              className="studio-select"
              value={kind}
              aria-label="Oscillator"
              onChange={(event) => {
                const next = oscillatorKinds.find((item) => item === event.target.value);
                if (next) setKind(next);
              }}
            >
              <option value="rsi">RSI</option>
              <option value="roc">Rate of change</option>
              <option value="zscore">Z-score</option>
              <option value="atr">ATR</option>
              <option value="stdev">Return std dev</option>
              <option value="williams">Williams %R</option>
              <option value="cci">CCI</option>
            </select>
            <input
              className="studio-select"
              type="number"
              min={2}
              max={500}
              value={period}
              aria-label="Period"
              onChange={(event) => setPeriod(event.target.value)}
            />
            <button type="submit" className="chip" disabled={!valid}>
              Add
            </button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
