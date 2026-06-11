"use client";

import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hand,
  ImageIcon,
  LineSquiggle,
  MousePointer,
  Plus,
  RectangleHorizontal,
  Redo,
  Shapes,
  Square,
  TextCursorIcon,
  Undo,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { WhiteboardTool } from "@/lib/whiteboard-types";
import { templateRegistry } from "./templates";

const COLORS = [
  "#000000",
  "#6366f1",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#a1bc98",
  "#14b8a6",
  "#3b82f6",
  "#64748b",
] as const;

export interface WhiteboardBottomBarProps {
  selectedTool: WhiteboardTool;
  selectedThickness: number;
  selectedColor: string;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: WhiteboardTool) => void;
  onThicknessChange: (thickness: number) => void;
  onColorChange: (color: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddComponent: (
    componentType: string,
    defaultSize: { width: number; height: number },
    defaultData: Record<string, unknown>,
  ) => void;
  onImageUpload: (file: File) => void;
}

export function WhiteboardBottomBar({
  selectedTool,
  selectedThickness,
  selectedColor,
  canUndo,
  canRedo,
  onToolChange,
  onThicknessChange,
  onColorChange,
  onUndo,
  onRedo,
  onAddComponent,
  onImageUpload,
}: WhiteboardBottomBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="absolute cursor-auto z-50 border bg-surface shadow-xs bottom-2 left-1/2 -translate-x-1/2 w-fit rounded-full py-2 px-3 flex flex-row items-center gap-2">
      <Popover>
        <PopoverTrigger onClick={() => onToolChange("pen")} asChild>
          <Button
            className={cn(selectedTool === "pen" && "border-2 border-primary")}
            size="icon-sm"
            variant="outline"
          >
            <LineSquiggle />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          className="border rounded-full w-fit! px-1 py-1.5 bg-muted flex flex-col gap-1 items-center z-99!"
        >
          <div className="w-3.5 h-3.5 bg-primary rounded-full" />
          <Slider
            orientation="vertical"
            min={2}
            max={24}
            value={[selectedThickness]}
            onValueChange={(e) => onThicknessChange(e[0])}
            thumbClassName="bg-primary"
            thumbSize={
              selectedThickness > 16
                ? 16
                : selectedThickness > 8
                  ? selectedThickness
                  : 8
            }
          />
          <div className="w-1 h-1 bg-primary rounded-full" />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            className={cn(
              (selectedTool === "square" ||
                selectedTool === "rectangle" ||
                selectedTool === "circle" ||
                selectedTool === "arrow") &&
                "border-2 border-primary",
            )}
            size="icon-sm"
            variant="outline"
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
            className={cn(selectedTool === "square" && "border border-primary")}
            onClick={() => onToolChange("square")}
            variant="outline"
            size="icon-xs"
          >
            <Square />
          </Button>
          <Button
            className={cn(
              selectedTool === "rectangle" && "border border-primary",
            )}
            onClick={() => onToolChange("rectangle")}
            variant="outline"
            size="icon-xs"
          >
            <RectangleHorizontal />
          </Button>
          <Button
            className={cn(selectedTool === "circle" && "border border-primary")}
            onClick={() => onToolChange("circle")}
            variant="outline"
            size="icon-xs"
          >
            <Circle />
          </Button>
          <Button
            className={cn(selectedTool === "arrow" && "border border-primary")}
            onClick={() => onToolChange("arrow")}
            variant="outline"
            size="icon-xs"
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
      >
        <TextCursorIcon />
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

      <Button
        className={cn(selectedTool === "eraser" && "border-2 border-primary")}
        onClick={() => onToolChange("eraser")}
        size="icon-sm"
        variant="outline"
      >
        <Eraser />
      </Button>

      <div className="w-px h-5 bg-primary" />

      <Button
        className={cn(selectedTool === "hand" && "border-2 border-primary")}
        onClick={() => onToolChange("hand")}
        size="icon-sm"
        variant="outline"
      >
        <Hand />
      </Button>

      <Button
        className={cn(selectedTool === "pointer" && "border-2 border-primary")}
        onClick={() => onToolChange("pointer")}
        size="icon-sm"
        variant="outline"
      >
        <MousePointer />
      </Button>

      <div className="w-px h-5 bg-primary" />

      <Popover>
        <PopoverTrigger asChild>
          <Button size="icon-sm" variant="outline">
            <svg
              style={{ backgroundColor: selectedColor }}
              className="w-full h-full rounded-full"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          className="border rounded-full w-fit! px-1 py-1.5 bg-muted flex flex-col gap-2 items-center z-99!"
        >
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onColorChange(color)}
              className={cn(
                selectedColor === color && "border-primary!",
                "w-4 h-4 rounded-full hover:shadow-xs border border-transparent hover:border-primary transition-all",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </PopoverContent>
      </Popover>

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
          <Button size="icon-sm" variant="outline">
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
    </div>
  );
}
