"use client";

import { formatBytes } from "@repo/cloud-ui/format";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { fileIcon, fileKind, kindColorClass } from "@/lib/file-kind";
import { Thumbnail } from "./thumbnail";

const SWIPE_PX = 60;

export interface LightboxItem {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
}

/**
 * The chrome every full-screen file view shares: a dark scrim that owns the
 * viewport, the file's name and place in the set, its neighbours along the
 * bottom, arrow keys and swipes to walk between them, and Esc to leave. What
 * goes in the header's action slot and what renders the file are the
 * caller's — the signed-in browser and a share link's page differ only there.
 */
export function LightboxFrame<T extends LightboxItem>({
  items,
  itemId,
  onSelect,
  onClose,
  thumbnail,
  actions,
  aside,
  detailsOpen = false,
  onToggleDetails,
  keyboardPaused = false,
  children,
}: {
  items: T[];
  itemId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  thumbnail: (item: T, width: 256 | 512 | 1024) => string | null;
  /** Header buttons between the title and Close. */
  actions?: ReactNode;
  /** A pane beside the renderer, when open. */
  aside?: ReactNode;
  detailsOpen?: boolean;
  /** Bound to `i`; Esc closes the pane before it closes the view. */
  onToggleDetails?: () => void;
  /** True while a dialog above the frame should own the keyboard. */
  keyboardPaused?: boolean;
  children: (item: T) => ReactNode;
}) {
  const index = items.findIndex((item) => item.id === itemId);
  const item = index >= 0 ? items[index] : undefined;
  const previous = index > 0 ? items[index - 1] : undefined;
  const next =
    index >= 0 && index < items.length - 1 ? items[index + 1] : undefined;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        keyboardPaused
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (detailsOpen && onToggleDetails) onToggleDetails();
        else onClose();
      }
      if (event.key === "ArrowLeft" && previous) {
        event.preventDefault();
        onSelect(previous.id);
      }
      if (event.key === "ArrowRight" && next) {
        event.preventDefault();
        onSelect(next.id);
      }
      if (
        event.key === "i" &&
        !event.metaKey &&
        !event.ctrlKey &&
        onToggleDetails
      ) {
        event.preventDefault();
        onToggleDetails();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    onClose,
    onSelect,
    previous,
    next,
    detailsOpen,
    onToggleDetails,
    keyboardPaused,
  ]);

  // The overlay owns the viewport while it is open, and focus has to follow it
  // in — otherwise Tab keeps walking the page behind the overlay and screen
  // readers never enter the dialog. Focus goes back where it came from on
  // close so keyboard position is not lost.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    containerRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  // The item can vanish underneath the overlay — deleted here, or renamed and
  // refetched. Closing properly also clears the ?preview= parameter, which a
  // bare `return null` would leave behind in a shareable URL.
  const missing = index < 0 && items.length > 0;
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  // Swipe between neighbours. Only a mostly-horizontal, fast enough move
  // counts, so a scroll inside a PDF or a pinch never flips the file.
  const touchStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const swipeHandlers = {
    onTouchStart: (event: React.TouchEvent) => {
      if (event.touches.length !== 1) {
        touchStart.current = null;
        return;
      }
      const touch = event.touches[0];
      if (touch) {
        touchStart.current = {
          at: Date.now(),
          x: touch.clientX,
          y: touch.clientY,
        };
      }
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      const touch = event.changedTouches[0];
      if (!start || !touch || Date.now() - start.at > 600) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0 && next) onSelect(next.id);
      if (dx > 0 && previous) onSelect(previous.id);
    },
  };

  // Keep the current thumbnail in view along the filmstrip.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-strip-id="${itemId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [itemId]);

  if (!item) return null;
  const kind = fileKind(item.filename, item.mimeType);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white outline-none animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={item.filename}
    >
      <header className="flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3">
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-medium" title={item.filename}>
            {item.filename}
          </p>
          <p className="truncate text-xs text-white/60">
            {items.length > 1 ? `${index + 1} of ${items.length} · ` : ""}
            {formatBytes(item.sizeBytes)}
          </p>
        </div>
        {actions}
        <LightboxButton label="Close" onClick={onClose}>
          <X className="size-5" />
        </LightboxButton>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col text-foreground"
          {...swipeHandlers}
        >
          <div
            className="flex min-h-0 flex-1 flex-col"
            style={{ viewTransitionName: "lightbox-media" }}
          >
            {children(item)}
          </div>
          {previous && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous file"
              className="absolute left-2 top-1/2 hidden size-10 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white md:flex"
              onClick={() => onSelect(previous.id)}
            >
              <ChevronLeft className="size-5" />
            </Button>
          )}
          {next && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next file"
              className="absolute right-2 top-1/2 hidden size-10 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white md:flex"
              onClick={() => onSelect(next.id)}
            >
              <ChevronRight className="size-5" />
            </Button>
          )}
        </div>

        {detailsOpen && aside && (
          <aside className="w-full max-w-xs shrink-0 overflow-y-auto border-l border-white/10 bg-black/60 p-4 text-sm">
            {aside}
          </aside>
        )}
      </div>

      {items.length > 1 && (
        <div
          ref={stripRef}
          className="scrollbar-thin hidden h-[4.5rem] shrink-0 items-center gap-1.5 overflow-x-auto px-3 md:flex"
        >
          {items.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              data-strip-id={candidate.id}
              aria-label={candidate.filename}
              aria-current={candidate.id === itemId ? "true" : undefined}
              onClick={() => onSelect(candidate.id)}
              className={cn(
                "size-14 shrink-0 overflow-hidden rounded-md ring-offset-black transition-opacity",
                candidate.id === itemId
                  ? "opacity-100 ring-2 ring-white ring-offset-2"
                  : "opacity-60 hover:opacity-100",
              )}
            >
              <Thumbnail
                src={thumbnail(candidate, 256)}
                alt=""
                fallback={fileIcon(candidate.filename, candidate.mimeType)}
                className="size-full rounded-none bg-white/10"
                iconClassName={cn(
                  "size-6",
                  kindColorClass(
                    fileKind(candidate.filename, candidate.mimeType),
                  ),
                )}
              />
            </button>
          ))}
        </div>
      )}

      <p className="sr-only">
        {kind === "image" ? "Pinch or double-tap to zoom. " : ""}
        {onToggleDetails ? "Press i for details, " : "Press "}Escape to close.
      </p>
    </div>
  );
}

export function LightboxButton({
  label,
  onClick,
  asChild,
  children,
}: {
  label: string;
  onClick?: () => void;
  asChild?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-9 text-white hover:bg-white/10 hover:text-white"
      aria-label={label}
      title={label}
      onClick={onClick}
      asChild={asChild}
    >
      {children}
    </Button>
  );
}
