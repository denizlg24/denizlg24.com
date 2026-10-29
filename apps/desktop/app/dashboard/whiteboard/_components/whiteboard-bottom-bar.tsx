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
  type LucideIcon,
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
import type { WhiteboardTool } from "@/lib/whiteboard-types";
import { templateRegistry } from "./templates";
import { ColorField } from "./whiteboard-color-picker";
import { BarDivider, FloatingBar, ToolButton } from "./whiteboard-floating";

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
      className="flex w-fit flex-col items-center gap-1.5 px-1.5 py-2"
    >
      <div className="size-3.5 rounded-full bg-primary" />
      <Slider
        orientation="vertical"
        min={min}
        max={max}
        value={[value]}
        onValueChange={(e) => e[0] !== undefined && onChange(e[0])}
        thumbClassName="bg-primary"
        thumbSize={value > 16 ? 16 : value > 8 ? value : 8}
      />
      <div className="size-1 rounded-full bg-primary" />
    </PopoverContent>
  );
}

const SHAPE_OPTIONS: {
  tool: WhiteboardTool;
  label: string;
  icon: LucideIcon;
}[] = [
  { tool: "rectangle", label: "Rectangle — R", icon: RectangleHorizontal },
  { tool: "square", label: "Square", icon: Square },
  { tool: "circle", label: "Ellipse — O", icon: Circle },
  { tool: "line", label: "Line — L", icon: Minus },
  { tool: "arrow", label: "Arrow — A", icon: ArrowUpRight },
];

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
    <FloatingBar className="bottom-3 left-1/2 w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2">
      <ToolButton
        label="Select — V"
        active={selectedTool === "pointer"}
        onClick={() => onToolChange("pointer")}
      >
        <MousePointer />
      </ToolButton>
      <ToolButton
        label="Pan — Space"
        active={selectedTool === "hand"}
        onClick={() => onToolChange("hand")}
      >
        <Hand />
      </ToolButton>

      <BarDivider />

      <Popover>
        <PopoverTrigger onClick={() => onToolChange("pen")} asChild>
          <ToolButton label="Pen — P" active={selectedTool === "pen"}>
            <LineSquiggle />
          </ToolButton>
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
          <ToolButton
            label="Highlighter — H"
            active={selectedTool === "highlighter"}
          >
            <Highlighter />
          </ToolButton>
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
          <ToolButton label="Shapes" active={shapeActive}>
            <Shapes />
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          className="flex w-fit flex-col gap-0.5 p-0.5"
        >
          {SHAPE_OPTIONS.map(({ tool, label, icon: Icon }) => (
            <ToolButton
              key={tool}
              label={label}
              active={selectedTool === tool}
              onClick={() => onToolChange(tool)}
            >
              <Icon />
            </ToolButton>
          ))}
        </PopoverContent>
      </Popover>

      <ToolButton
        label="Text — T"
        active={selectedTool === "text"}
        onClick={() => onToolChange("text")}
      >
        <TextCursorIcon />
      </ToolButton>
      <ToolButton
        label="Fill — B"
        active={selectedTool === "bucket"}
        onClick={() => onToolChange("bucket")}
      >
        <PaintBucket />
      </ToolButton>
      <ToolButton
        label="Eraser — E"
        active={selectedTool === "eraser"}
        onClick={() => onToolChange("eraser")}
      >
        <Eraser />
      </ToolButton>
      <ToolButton label="Image" onClick={() => fileInputRef.current?.click()}>
        <ImageIcon />
      </ToolButton>
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

      <BarDivider />

      <ColorField
        value={selectedColor}
        onChange={onColorChange}
        recents={recentColors}
        title="Color"
      />

      <BarDivider />

      <ToolButton label="Undo" onClick={onUndo} disabled={!canUndo}>
        <Undo />
      </ToolButton>
      <ToolButton label="Redo" onClick={onRedo} disabled={!canRedo}>
        <Redo />
      </ToolButton>

      <BarDivider />

      <Popover>
        <PopoverTrigger asChild>
          <ToolButton label="Add component">
            <Plus />
          </ToolButton>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          className="flex w-fit flex-col items-stretch gap-0.5 p-1"
        >
          {Object.entries(templateRegistry).map(([key, def]) => {
            const Icon = def.icon;
            return (
              <Button
                key={key}
                variant="ghost"
                size="sm"
                className="justify-start"
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
      <ToolButton label="Elements" active={layersOpen} onClick={onToggleLayers}>
        <Layers />
      </ToolButton>
    </FloatingBar>
  );
}
