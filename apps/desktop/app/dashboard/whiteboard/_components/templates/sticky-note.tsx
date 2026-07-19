"use client";

import { Button } from "@repo/ui/button";
import { STICKY_COLORS } from "@repo/whiteboard-render";
import { Palette } from "lucide-react";
import { useState } from "react";
import type { TemplateProps } from ".";

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
