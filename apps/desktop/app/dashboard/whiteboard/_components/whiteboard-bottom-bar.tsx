"use client";

import { Button } from "@repo/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Slider } from "@repo/ui/slider";
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  ImageIcon,
  Layers,
  LineSquiggle,
  Minus,
  MousePointer,
  PaintBucket,
  Plus,
  RectangleHorizontal,
  Redo,
  Shapes,
  Square,
  TextCursorIcon,
  Undo,
} from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { WhiteboardTool } from "@/lib/whiteboard-types";
import { templateRegistry } from "./templates";
import { ColorField } from "./whiteboard-color-picker";

const SHAPE_TOOLS: WhiteboardTool[] = [
  "square",
  "rectangle",
  "circle",
  "line",
  "arrow",
];

export interface WhiteboardBottomBarProps {
  selectedTool: WhiteboardTool;
  penThickness: number;
  highlighterThickness: number;
  selectedColor: string;
  recentColors: string[];
  canUndo: boolean;
  canRedo: boolean;
  layersOpen: boolean;
  onToolChange: (tool: WhiteboardTool) => void;
  onPenThicknessChange: (t: number) => void;
  onHighlighterThicknessChange: (t: number) => void;
  onColorChange: (color: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleLayers: () => void;
  onAddComponent: (
    componentType: string,
    defaultSize: { width: number; height: number },
    defaultData: Record<string, unknown>,
  ) => void;
  onImageUpload: (file: File) => void;
}

function ThicknessSlider({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <PopoverContent
      side="top"
      align="center"
      className="border rounded-full w-fit! px-1 py-1.5 bg-muted flex flex-col gap-1 items-center z-99!"
    >
      <div className="w-3.5 h-3.5 bg-primary rounded-full" />
      <Slider
        orientation="vertical"
        min={min}
        max={max}
        value={[value]}
        onValueChange={(e) => e[0] !== undefined && onChange(e[0])}
        thumbClassName="bg-primary"
        thumbSize={value > 16 ? 16 : value > 8 ? value : 8}
      />
      <div className="w-1 h-1 bg-primary rounded-full" />
    </PopoverContent>
  );
}

export function WhiteboardBottomBar({
  selectedTool,
  penThickness,
  highlighterThickness,
  selectedColor,
  recentColors,
  canUndo,
  canRedo,
  layersOpen,
  onToolChange,
  onPenThicknessChange,
  onHighlighterThicknessChange,
  onColorChange,
  onUndo,
  onRedo,
  onToggleLayers,
  onAddComponent,
  onImageUpload,
}: WhiteboardBottomBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shapeActive = SHAPE_TOOLS.includes(selectedTool);

  return (
    <div className="absolute cursor-auto z-40 border bg-surface shadow-xs bottom-2 left-1/2 -translate-x-1/2 w-fit max-w-[calc(100vw-1rem)] overflow-x-auto rounded-full py-2 px-3 flex flex-row items-center gap-2">
      <Button
        className={cn(selectedTool === "pointer" && "border-2 border-primary")}
        onClick={() => onToolChange("pointer")}
        size="icon-sm"
        variant="outline"
        title="Select — V"
      >
        <MousePointer />
      </Button>

      <Button
        className={cn(selectedTool === "hand" && "border-2 border-primary")}
        onClick={() => onToolChange("hand")}
        size="icon-sm"
        variant="outline"
        title="Pan — hold Space"
      >
        <Hand />
      </Button>

      <div className="w-px h-5 bg-border" />

      <Popover>
        <PopoverTrigger onClick={() => onToolChange("pen")} asChild>
          <Button
            className={cn(selectedTool === "pen" && "border-2 border-primary")}
            size="icon-sm"
            variant="outline"
            title="Pen — P"
          >
            <LineSquiggle />
          </Button>
        </PopoverTrigger>
        <ThicknessSlider
          value={penThickness}
          min={2}
          max={24}
          onChange={onPenThicknessChange}
        />
      </Popover>

      <Popover>
        <PopoverTrigger onClick={() => onToolChange("highlighter")} asChild>
          <Button
            className={cn(
              selectedTool === "highlighter" && "border-2 border-primary",
            )}
            size="icon-sm"
            variant="outline"
            title="Highlighter — H"
          >
            <Highlighter />
          </Button>
        </PopoverTrigger>
        <ThicknessSlider
          value={highlighterThickness}
          min={6}
          max={40}
          onChange={onHighlighterThicknessChange}
        />
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            className={cn(shapeActive && "border-2 border-primary")}
            size="icon-sm"
            variant="outline"
            title="Shapes"
          >
            <Shapes />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          className="border rounded-full w-fit! px-1 py-1.5 bg-muted flex flex-col gap-2 items-center z-99!"
        >
          <Button
            className={cn(
              selectedTool === "rectangle" && "border border-primary",
            )}
            onClick={() => onToolChange("rectangle")}
            variant="outline"
            size="icon-xs"
            title="Rectangle — R"
          >
            <RectangleHorizontal />
          </Button>
          <Button
            className={cn(selectedTool === "square" && "border border-primary")}
            onClick={() => onToolChange("square")}
            variant="outline"
            size="icon-xs"
            title="Square"
          >
            <Square />
          </Button>
          <Button
            className={cn(selectedTool === "circle" && "border border-primary")}
            onClick={() => onToolChange("circle")}
            variant="outline"
            size="icon-xs"
            title="Ellipse — O"
          >
            <Circle />
          </Button>
          <Button
            className={cn(selectedTool === "line" && "border border-primary")}
            onClick={() => onToolChange("line")}
            variant="outline"
            size="icon-xs"
            title="Line — L"
          >
            <Minus />
          </Button>
          <Button
            className={cn(selectedTool === "arrow" && "border border-primary")}
            onClick={() => onToolChange("arrow")}
            variant="outline"
            size="icon-xs"
            title="Arrow — A"
          >
            <ArrowUpRight />
          </Button>
        </PopoverContent>
      </Popover>

      <Button
        className={cn(selectedTool === "text" && "border-2 border-primary")}
        onClick={() => onToolChange("text")}
        size="icon-sm"
        variant="outline"
        title="Text — T"
      >
        <TextCursorIcon />
      </Button>

      <Button
        className={cn(selectedTool === "bucket" && "border-2 border-primary")}
        onClick={() => onToolChange("bucket")}
        size="icon-sm"
        variant="outline"
        title="Fill — B"
      >
        <PaintBucket />
      </Button>

      <Button
        className={cn(selectedTool === "eraser" && "border-2 border-primary")}
        onClick={() => onToolChange("eraser")}
        size="icon-sm"
        variant="outline"
        title="Eraser — E"
      >
        <Eraser />
      </Button>

      <Button
        size="icon-sm"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        title="Upload image"
      >
        <ImageIcon />
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImageUpload(file);
          e.target.value = "";
        }}
      />

      <div className="w-px h-5 bg-border" />

      <ColorField
        value={selectedColor}
        onChange={onColorChange}
        recents={recentColors}
        title="Color"
      />

      <Button
        size="icon-sm"
        variant="outline"
        onClick={onUndo}
        disabled={!canUndo}
      >
        <Undo />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        onClick={onRedo}
        disabled={!canRedo}
      >
        <Redo />
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button size="icon-sm" variant="outline" title="Add component">
            <Plus />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          className="border rounded-lg w-fit! px-2 py-2 bg-muted flex flex-col gap-1 items-stretch z-99!"
        >
          {Object.entries(templateRegistry).map(([key, def]) => {
            const Icon = def.icon;
            return (
              <Button
                key={key}
                variant="outline"
                size="sm"
                onClick={() =>
                  onAddComponent(key, def.defaultSize, { ...def.defaultData })
                }
              >
                <Icon />
                {def.name}
              </Button>
            );
          })}
        </PopoverContent>
      </Popover>

      <Button
        className={cn(layersOpen && "border-2 border-primary")}
        size="icon-sm"
        variant="outline"
        onClick={onToggleLayers}
        title="Elements"
      >
        <Layers />
      </Button>
    </div>
  );
}
