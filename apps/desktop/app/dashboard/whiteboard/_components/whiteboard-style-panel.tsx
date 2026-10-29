"use client";

import type {
  IShapeData,
  ITextData,
  IWhiteboardElement,
  TextFontFamily,
} from "@repo/schemas";
import { textDataSchema, whiteboardElementKind } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import {
  STICKY_COLORS,
  WHITEBOARD_FONT_FAMILIES,
} from "@repo/whiteboard-render";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronsDown,
  ChevronsUp,
  Minus,
  Plus,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ColorField } from "./whiteboard-color-picker";
import { BarDivider, FloatingBar, ToolButton } from "./whiteboard-floating";

type Mutator = (el: IWhiteboardElement) => IWhiteboardElement | null;

interface StylePanelProps {
  selected: IWhiteboardElement[];
  onUpdateStyle: (mutate: Mutator) => void;
  onReorder: (op: "front" | "back" | "forward" | "backward") => void;
  recents: string[];
  onPickColor: (color: string) => void;
}

const FONT_WEIGHTS: { label: string; value: number }[] = [
  { label: "R", value: 400 },
  { label: "M", value: 500 },
  { label: "B", value: 700 },
];

const FONT_SIZE_PRESETS = [16, 24, 32, 48];

function firstOf<T>(
  els: IWhiteboardElement[],
  pick: (el: IWhiteboardElement) => T | undefined,
): T | undefined {
  for (const el of els) {
    const v = pick(el);
    if (v !== undefined) return v;
  }
  return undefined;
}

export function WhiteboardStylePanel({
  selected,
  onUpdateStyle,
  onReorder,
  recents,
  onPickColor,
}: StylePanelProps) {
  const kinds = new Set(selected.map((el) => whiteboardElementKind(el)));
  const hasStroke = kinds.has("pen") || kinds.has("shape") || kinds.has("text");
  const hasShape = kinds.has("shape");
  const hasText = kinds.has("text");
  const stickyEls = selected.filter(
    (el) => el.type === "component" && el.componentType === "sticky-note",
  );

  const color =
    firstOf(selected, (el) => {
      const kind = whiteboardElementKind(el);
      if (kind === "pen" || kind === "shape" || kind === "text") {
        return (el.data as { color?: string }).color;
      }
      return undefined;
    }) ?? "#18181b";

  const thickness =
    firstOf(selected, (el) => {
      const kind = whiteboardElementKind(el);
      if (kind === "pen" || kind === "shape") {
        return (el.data as { thickness?: number }).thickness;
      }
      return undefined;
    }) ?? 4;

  const fill =
    firstOf(selected, (el) =>
      whiteboardElementKind(el) === "shape"
        ? ((el.data as IShapeData).fill ?? "none")
        : undefined,
    ) ?? "none";

  const textData = firstOf(selected, (el) => {
    if (whiteboardElementKind(el) !== "text") return undefined;
    const parsed = textDataSchema.safeParse(el.data);
    return parsed.success ? parsed.data : undefined;
  });

  const setData = (
    mutate: (data: Record<string, unknown>) => Record<string, unknown> | null,
  ) =>
    onUpdateStyle((el) => {
      const next = mutate(el.data);
      if (!next) return null;
      return { ...el, data: next };
    });

  const setColor = (c: string) => {
    onPickColor(c);
    onUpdateStyle((el) => {
      const kind = whiteboardElementKind(el);
      if (kind !== "pen" && kind !== "shape" && kind !== "text") return null;
      return { ...el, data: { ...el.data, color: c } };
    });
  };

  const setThickness = (t: number) =>
    onUpdateStyle((el) => {
      const kind = whiteboardElementKind(el);
      if (kind !== "pen" && kind !== "shape") return null;
      return { ...el, data: { ...el.data, thickness: t } };
    });

  const setFill = (f: string) => {
    if (f !== "none") onPickColor(f);
    onUpdateStyle((el) => {
      if (whiteboardElementKind(el) !== "shape") return null;
      const data = { ...el.data } as Record<string, unknown>;
      if (f === "none") delete data.fill;
      else data.fill = f;
      return { ...el, data };
    });
  };

  const setText = (patch: Partial<ITextData>) =>
    onUpdateStyle((el) => {
      if (whiteboardElementKind(el) !== "text") return null;
      return { ...el, data: { ...el.data, ...patch } };
    });

  return (
    <FloatingBar className="top-3 left-1/2 max-w-[calc(100%-1.5rem)] -translate-x-1/2">
      {hasStroke && (
        <ColorField
          value={color}
          onChange={setColor}
          recents={recents}
          title="Color"
        />
      )}

      {(kinds.has("pen") || hasShape) && (
        <div className="flex items-center gap-0.5">
          <ToolButton
            label="Thinner"
            size="icon-xs"
            onClick={() => setThickness(Math.max(1, thickness - 1))}
          >
            <Minus />
          </ToolButton>
          <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(thickness)}
          </span>
          <ToolButton
            label="Thicker"
            size="icon-xs"
            onClick={() => setThickness(thickness + 1)}
          >
            <Plus />
          </ToolButton>
        </div>
      )}

      {hasShape && (
        <ColorField
          value={fill}
          onChange={setFill}
          recents={recents}
          allowNone
          title="Fill"
        />
      )}

      {hasText && textData && (
        <>
          <BarDivider />
          <Popover>
            <PopoverTrigger asChild>
              <ToolButton label="Text">
                <Type />
              </ToolButton>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="center"
              className="flex w-60 flex-col gap-2 p-2"
            >
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  value={Math.round(textData.fontSize)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n > 0) setText({ fontSize: n });
                  }}
                  className="h-7 w-16 text-xs"
                />
                <div className="flex gap-1">
                  {FONT_SIZE_PRESETS.map((s) => (
                    <ToolButton
                      key={s}
                      label={`${s}px`}
                      size="icon-xs"
                      className="text-[11px] tabular-nums"
                      active={Math.round(textData.fontSize) === s}
                      onClick={() => setText({ fontSize: s })}
                    >
                      {s}
                    </ToolButton>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                {FONT_WEIGHTS.map((w) => (
                  <ToolButton
                    key={w.value}
                    label={`Weight ${w.value}`}
                    size="icon-xs"
                    active={(textData.fontWeight ?? 400) === w.value}
                    style={{ fontWeight: w.value }}
                    onClick={() => setText({ fontWeight: w.value })}
                  >
                    {w.label}
                  </ToolButton>
                ))}
                <BarDivider />
                {(
                  [
                    ["left", AlignLeft],
                    ["center", AlignCenter],
                    ["right", AlignRight],
                  ] as const
                ).map(([a, Icon]) => (
                  <ToolButton
                    key={a}
                    label={`Align ${a}`}
                    size="icon-xs"
                    active={(textData.align ?? "left") === a}
                    onClick={() => setText({ align: a })}
                  >
                    <Icon />
                  </ToolButton>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(
                  Object.keys(WHITEBOARD_FONT_FAMILIES) as TextFontFamily[]
                ).map((fam) => (
                  <Button
                    key={fam}
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "justify-start text-xs",
                      (textData.fontFamily ?? "handwriting") === fam &&
                        "bg-surface text-accent-strong",
                    )}
                    style={{ fontFamily: WHITEBOARD_FONT_FAMILIES[fam].css }}
                    onClick={() => setText({ fontFamily: fam })}
                  >
                    {WHITEBOARD_FONT_FAMILIES[fam].label}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}

      {stickyEls.length > 0 && (
        <>
          <BarDivider />
          <div className="flex items-center gap-0.5">
            {STICKY_COLORS.map((c, i) => (
              <button
                key={c.name}
                type="button"
                title={c.name}
                aria-label={c.name}
                onClick={() => setData((data) => ({ ...data, colorIndex: i }))}
                className="size-4 rounded-full border border-border/40 hover:scale-110 transition-transform"
                style={{ backgroundColor: c.dot }}
              />
            ))}
          </div>
        </>
      )}

      <BarDivider />
      <div className="flex items-center gap-0.5">
        <ToolButton label="Bring to front" onClick={() => onReorder("front")}>
          <ChevronsUp />
        </ToolButton>
        <ToolButton label="Send to back" onClick={() => onReorder("back")}>
          <ChevronsDown />
        </ToolButton>
      </div>
    </FloatingBar>
  );
}
