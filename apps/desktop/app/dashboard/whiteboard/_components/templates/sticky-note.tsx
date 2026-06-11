"use client";

import { Palette } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TemplateProps } from ".";

interface StickyColor {
  name: string;
  bg: string;
  text: string;
  border: string;
  placeholder: string;
  dot: string;
}

const STICKY_COLORS: StickyColor[] = [
  {
    name: "Sage",
    bg: "#e8edd9",
    text: "#3a4535",
    border: "#c8d4b0",
    placeholder: "#7a8a6e",
    dot: "#a1bc98",
  },
  {
    name: "Sand",
    bg: "#ece6da",
    text: "#4a3f30",
    border: "#d4c9b5",
    placeholder: "#8a7e6c",
    dot: "#c4b69c",
  },
  {
    name: "Clay",
    bg: "#ecddd5",
    text: "#4a3530",
    border: "#d4bfb3",
    placeholder: "#8a6e62",
    dot: "#c09a8a",
  },
  {
    name: "Fog",
    bg: "#e2e4e0",
    text: "#353835",
    border: "#c5c9c2",
    placeholder: "#6e756c",
    dot: "#9aa397",
  },
  {
    name: "Lavender",
    bg: "#e4dfe8",
    text: "#3a3540",
    border: "#c6bdd0",
    placeholder: "#7a7088",
    dot: "#a899b8",
  },
  {
    name: "Lichen",
    bg: "#dce6e2",
    text: "#2e3d38",
    border: "#b5cdc4",
    placeholder: "#627a72",
    dot: "#89b0a4",
  },
];

export const StickyNoteTemplate = ({
  width,
  height,
  data,
  onDataChange,
}: TemplateProps) => {
  const content = (data.content as string) || "";
  const colorIndex = (data.colorIndex as number) ?? 0;
  const color = STICKY_COLORS[colorIndex % STICKY_COLORS.length];
  const [showColors, setShowColors] = useState(false);

  return (
    <div
      className="border shadow-sm rounded-lg flex flex-col"
      style={{
        width,
        height,
        backgroundColor: color.bg,
        borderColor: color.border,
        color: color.text,
      }}
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-1 shrink-0">
        <span
          className="text-xs font-semibold uppercase tracking-wide select-none"
          style={{ color: color.placeholder }}
        >
          Note
        </span>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-xs"
            className="hover:bg-black/10"
            style={{ color: color.placeholder }}
            onClick={() => setShowColors(!showColors)}
          >
            <Palette className="size-3.5" />
          </Button>
          {showColors && (
            <div className="absolute right-0 top-full mt-1 flex flex-row gap-1.5 bg-popover/95 backdrop-blur-sm rounded-md p-1.5 shadow-md border border-border z-10">
              {STICKY_COLORS.map((c, i) => (
                <button
                  type="button"
                  key={c.name}
                  title={c.name}
                  className={`size-5 rounded-full hover:scale-110 transition-transform ${i === colorIndex ? "ring-2 ring-offset-1 ring-accent-strong/40" : ""}`}
                  style={{ backgroundColor: c.dot }}
                  onClick={() => {
                    onDataChange({ ...data, colorIndex: i });
                    setShowColors(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <textarea
        className="flex-1 w-full resize-none px-3 pb-3 text-sm leading-relaxed focus:outline-none"
        style={{
          backgroundColor: color.bg,
          color: color.text,
          caretColor: color.text,
        }}
        value={content}
        onChange={(e) => onDataChange({ ...data, content: e.target.value })}
        placeholder="Write something..."
      />
      <style>{`
        textarea::placeholder { color: ${color.placeholder}; }
      `}</style>
    </div>
  );
};
