"use client";

import type { BlockOf } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { resolveEmbed } from "@repo/utils/workspace-embeds";
import { ExternalLink, Link2 } from "lucide-react";
import { useRef, useState } from "react";
import { useAdmin } from "../../provider";

type EmbedBlockProps = {
  block: BlockOf<"embed">;
  editable: boolean;
  selected: boolean;
  onChange: (block: BlockOf<"embed">) => void;
};

const MIN = 80;
const MAX = 2000;

function UrlInput({
  onSubmit,
  initial = "",
}: {
  onSubmit: (url: string) => void;
  initial?: string;
}) {
  return (
    <input
      defaultValue={initial}
      placeholder="Paste a link: YouTube, Spotify, Figma, Maps, Docs, a video or any page"
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        const value = event.currentTarget.value.trim();
        if (/^https?:\/\//.test(value)) onSubmit(value);
      }}
      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
    />
  );
}

/** Any URL as a player, a media element or a sandboxed page; drag the bottom edge to resize. */
export function EmbedBlock({
  block,
  editable,
  selected,
  onChange,
}: EmbedBlockProps) {
  const { platform } = useAdmin();
  const [editing, setEditing] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const source = block.url ? resolveEmbed(block.url) : null;

  if (!block.url || !source || editing) {
    if (!editable) return null;
    return (
      <div className="flex items-center gap-2 rounded-sm bg-surface/50 px-2 py-1.5 text-muted-foreground">
        <Link2 className="size-4 shrink-0" />
        <UrlInput
          initial={block.url}
          onSubmit={(url) => {
            setEditing(false);
            onChange({ ...block, url });
          }}
        />
        {block.url && !source ? (
          <span className="text-xs text-destructive">Not a web link</span>
        ) : null}
      </div>
    );
  }

  const height =
    dragHeight ??
    block.height ??
    (source.kind === "frame" ? source.height : undefined);
  const aspect = source.kind === "frame" && !height ? source.aspect : null;

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const start = event.clientY;
    const initial = frameRef.current?.getBoundingClientRect().height ?? 360;
    let latest = initial;
    const move = (e: PointerEvent) => {
      latest = Math.max(
        MIN,
        Math.min(MAX, Math.round(initial + e.clientY - start)),
      );
      setDragHeight(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragHeight(null);
      onChange({ ...block, height: latest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  let media: React.ReactNode;
  switch (source.kind) {
    case "video":
      media = (
        <video
          src={source.src}
          controls
          className="w-full rounded-md bg-black"
          style={height ? { height } : undefined}
        >
          <track kind="captions" />
        </video>
      );
      break;
    case "audio":
      media = (
        <audio src={source.src} controls className="w-full">
          <track kind="captions" />
        </audio>
      );
      break;
    case "image":
      media = (
        <img
          src={source.src}
          alt=""
          className="w-full rounded-md object-contain"
          style={height ? { height } : undefined}
        />
      );
      break;
    case "frame":
      media = (
        <iframe
          title={source.provider}
          src={source.src}
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox={
            source.trusted
              ? "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
              : "allow-scripts allow-popups allow-forms"
          }
          className="h-full w-full rounded-md border-0 bg-surface"
        />
      );
      break;
  }

  return (
    <div className="group/embed relative flex flex-col gap-1">
      <div
        ref={frameRef}
        className={cn(
          "relative w-full",
          dragHeight !== null && "pointer-events-none select-none",
        )}
        style={
          source.kind === "frame"
            ? height
              ? { height }
              : { aspectRatio: String(aspect ?? 16 / 9) }
            : undefined
        }
      >
        {media}
      </div>
      <div
        className={cn(
          "flex items-center gap-1 text-xs text-muted-foreground transition-opacity",
          selected ? "opacity-100" : "opacity-0 group-hover/embed:opacity-100",
        )}
      >
        <span className="truncate">{source.provider}</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void platform.openExternal(block.url)}
        >
          <ExternalLink /> Open
        </Button>
        {editable ? (
          <>
            {block.height ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  const { height: _h, ...rest } = block;
                  onChange(rest);
                }}
              >
                Auto height
              </Button>
            ) : null}
            <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
              Change
            </Button>
          </>
        ) : null}
      </div>
      {editable && source.kind !== "audio" ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize"
          onPointerDown={startDrag}
          className="absolute inset-x-0 bottom-5 h-2 cursor-row-resize opacity-0 group-hover/embed:opacity-100"
        >
          <div className="mx-auto mt-0.5 h-1 w-10 rounded-full bg-muted-foreground/40" />
        </div>
      ) : null}
    </div>
  );
}
