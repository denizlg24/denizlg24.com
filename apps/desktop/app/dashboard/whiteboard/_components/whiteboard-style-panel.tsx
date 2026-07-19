"use client";

import type {
  IShapeData,
  ITextData,
  IWhiteboardElement,
  TextFontFamily,
} from "@repo/schemas";
import { whiteboardElementKind } from "@repo/schemas";
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

  const textData = firstOf(selected, (el) =>
    whiteboardElementKind(el) === "text"
      ? (el.data as unknown as ITextData)
      : undefined,
  );

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
    <div className="absolute z-40 top-14 left-1/2 -translate-x-1/2 flex flex-row items-center gap-2 rounded-full border bg-surface px-3 py-1.5 shadow-xs overflow-x-auto max-w-[calc(100vw-1rem)]">
      {hasStroke && (
        <ColorField
          value={color}
          onChange={setColor}
          recents={recents}
          title="Color"
        />
      )}

      {(kinds.has("pen") || hasShape) && (
        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="outline"
            onClick={() => setThickness(Math.max(1, thickness - 1))}
          >
            <Minus />
          </Button>
          <span className="text-[10px] tabular-nums w-4 text-center text-muted-foreground">
            {Math.round(thickness)}
          </span>
          <Button
            size="icon-xs"
            variant="outline"
            onClick={() => setThickness(thickness + 1)}
          >
            <Plus />
          </Button>
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
          <div className="h-4 w-px bg-border" />
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon-sm" variant="outline" title="Text">
                <Type className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="center"
              className="w-56 p-2 z-99! flex flex-col gap-2"
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
                    <Button
                      key={s}
                      size="icon-xs"
                      variant="outline"
                      className="text-[10px]"
                      onClick={() => setText({ fontSize: s })}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {FONT_WEIGHTS.map((w) => (
                  <Button
                    key={w.value}
                    size="icon-xs"
                    variant="outline"
                    className={cn(
                      (textData.fontWeight ?? 400) === w.value &&
                        "border-primary",
                    )}
                    style={{ fontWeight: w.value }}
                    onClick={() => setText({ fontWeight: w.value })}
                  >
                    {w.label}
                  </Button>
                ))}
                <div className="h-4 w-px bg-border mx-0.5" />
                {(
                  [
                    ["left", AlignLeft],
                    ["center", AlignCenter],
                    ["right", AlignRight],
                  ] as const
                ).map(([a, Icon]) => (
                  <Button
                    key={a}
                    size="icon-xs"
                    variant="outline"
                    className={cn(
                      (textData.align ?? "left") === a && "border-primary",
                    )}
                    onClick={() => setText({ align: a })}
                  >
                    <Icon />
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(
                  Object.keys(WHITEBOARD_FONT_FAMILIES) as TextFontFamily[]
                ).map((fam) => (
                  <Button
                    key={fam}
                    size="sm"
                    variant="outline"
                    className={cn(
                      "h-7 justify-start text-xs",
                      (textData.fontFamily ?? "handwriting") === fam &&
                        "border-primary",
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
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1">
            {STICKY_COLORS.map((c, i) => (
              <button
                key={c.name}
                type="button"
                title={c.name}
                onClick={() => setData((data) => ({ ...data, colorIndex: i }))}
                className="size-4 rounded-full border border-border/40 hover:scale-110 transition-transform"
                style={{ backgroundColor: c.dot }}
              />
            ))}
          </div>
        </>
      )}

      <div className="h-4 w-px bg-border" />
      <div className="flex items-center gap-1">
        <Button
          size="icon-xs"
          variant="outline"
          title="Bring to front"
          onClick={() => onReorder("front")}
        >
          <ChevronsUp />
        </Button>
        <Button
          size="icon-xs"
          variant="outline"
          title="Send to back"
          onClick={() => onReorder("back")}
        >
          <ChevronsDown />
        </Button>
      </div>
    </div>
  );
}
