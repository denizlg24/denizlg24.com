"use client";

import { Eye, Pencil } from "lucide-react";
import { useState } from "react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import type { TemplateProps } from ".";

export const MarkdownTemplate = ({
  width,
  height,
  data,
  onDataChange,
}: TemplateProps) => {
  const content = (data.content as string) || "";
  const [editing, setEditing] = useState(!content);

  return (
    <div
      className="border border-border bg-background shadow-sm rounded-lg flex flex-col"
      style={{ width, height }}
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-2 border-b bg-input/25 rounded-tl-lg rounded-tr-lg shrink-0">
        <span className="text-sm font-semibold">Markdown</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setEditing(!editing)}
          title={editing ? "Preview" : "Edit"}
        >
          {editing ? (
            <Eye className="size-3.5" />
          ) : (
            <Pencil className="size-3.5" />
          )}
        </Button>
      </div>

      {editing ? (
        <textarea
          className="flex-1 w-full resize-none px-3 py-2 text-sm font-mono leading-relaxed bg-background placeholder:text-muted-foreground focus:outline-none"
          value={content}
          onChange={(e) => onDataChange({ ...data, content: e.target.value })}
          placeholder="# Hello World&#10;&#10;Write markdown here..."
        />
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {content ? (
            <MarkdownRenderer
              content={content}
              className="text-sm [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-2 [&_pre]:text-xs [&_pre]:my-2 [&_blockquote]:text-sm [&_blockquote]:my-2 [&_ul]:text-sm [&_ol]:text-sm [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-1 [&_h1]:mt-3 [&_h2]:mt-2 [&_h3]:mt-2 [&_img]:my-2"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm h-full">
              Nothing to preview
            </div>
          )}
        </div>
      )}
    </div>
  );
};
