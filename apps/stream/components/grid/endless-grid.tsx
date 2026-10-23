"use client";

import {
  type GridTitle,
  type MapHighlight,
  titleYears,
  tmdbImage,
} from "@repo/schemas/stream";
import {
  Bookmark,
  CornerDownLeft,
  Eye,
  LocateFixed,
  Move,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ARROWS,
  CAPTION_HEIGHT,
  type Cell,
  nearestRegion,
  pitchFor,
  visibleRange,
  wrappedKey,
} from "@/components/grid/grid-math";
import { type Kind, useGridData } from "@/components/grid/use-grid-data";
import { Rating } from "@/components/rating";

const BADGE = {
  watched: { Icon: Eye, label: "You've watched this" },
  saved: { Icon: Bookmark, label: "On your list" },
  picked: { Icon: Sparkles, label: "Picked for you" },
} as const;

const KINDS: { value: Kind; label: string }[] = [
  { value: null, label: "Everything" },
  { value: "movie", label: "Films" },
  { value: "series", label: "Series" },
];

function Tile({
  title,
  focused,
  highlight,
  width,
}: {
  title: GridTitle | undefined;
  focused: boolean;
  highlight: MapHighlight | undefined;
  width: number;
}) {
  const poster = title ? tmdbImage(title.posterPath, "w342") : null;
  const badge = highlight ? BADGE[highlight.kind] : null;
  return (
    <div
      className={`transition-[transform,opacity] duration-300 ease-out ${focused ? "scale-[1.12] opacity-100" : "opacity-55"}`}
      style={{ width }}
    >
      <div
        className={`relative aspect-[2/3] overflow-hidden rounded-lg bg-lift ${focused ? "shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)] ring-[3px] ring-amber" : "ring-1 ring-hairline ring-inset"}`}
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="size-full object-cover"
          />
        ) : title ? (
          <div className="flex size-full items-end p-3 font-display text-2xl text-paper/55">
            {title.title}
          </div>
        ) : (
          <div className="size-full animate-pulse bg-raised" />
        )}
        {badge ? (
          <span className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-ink/80 text-amber backdrop-blur-sm">
            <badge.Icon className="size-3.5" strokeWidth={2.25} aria-hidden />
          </span>
        ) : null}
      </div>
      <div style={{ height: CAPTION_HEIGHT }} className="pt-2.5">
        {title ? (
          <p
            className={`truncate text-sm ${focused ? "font-bold text-paper" : "text-paper/70"}`}
          >
            {title.title}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The catalogue as one endless lattice, ordered by taste so neighbours are
 * alike. Built for a remote first: arrows step one poster, the lattice glides
 * to keep focus centred, OK opens. Drag and the wheel do the same for a mouse.
 */
export function EndlessGrid({
  profiles,
  tv,
  focusId,
}: {
  profiles: string[];
  tv: boolean;
  focusId: string | null;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(null);
  const { meta, failed, highlights, cells, ensure } = useGridData({
    profiles: profiles.join(","),
    kind,
    focusId,
  });
  const [focus, setFocus] = useState<Cell>({ gx: 0, gy: 0 });
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [repeating, setRepeating] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; focus: Cell } | null>(null);
  const wheel = useRef({ x: 0, y: 0 });

  const pitch = useMemo(
    () => pitchFor(viewport.width, tv),
    [viewport.width, tv],
  );

  useEffect(() => {
    if (meta) setFocus(meta.start);
  }, [meta]);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const range = useMemo(
    () => visibleRange(focus, viewport, pitch),
    [focus, viewport, pitch],
  );

  useEffect(() => {
    ensure(range);
  }, [ensure, range]);

  const size = meta ? { width: meta.width, height: meta.height } : null;
  const titleAt = useCallback(
    (cell: Cell) => (size ? cells.get(wrappedKey(cell, size)) : undefined),
    [cells, size],
  );
  const focused = titleAt(focus);
  const region = meta && size ? nearestRegion(focus, meta.regions, size) : null;

  const move = useCallback((delta: Cell) => {
    setFocus((current) => ({
      gx: current.gx + delta.gx,
      gy: current.gy + delta.gy,
    }));
  }, []);

  const open = useCallback(() => {
    if (focused) router.push(`/title/${focused.id}`);
  }, [focused, router]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = ARROWS[event.key];
    if (delta) {
      event.preventDefault();
      setRepeating(event.repeat);
      move(delta);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    } else if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      const rows = Math.max(1, Math.floor(viewport.height / pitch.y) - 1);
      move({ gx: 0, gy: event.key === "PageDown" ? rows : -rows });
    } else if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault();
      document.querySelector<HTMLElement>("header [data-nav]")?.focus();
    }
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dragStart.current = { x: event.clientX, y: event.clientY, focus };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!drag && Math.hypot(dx, dy) < 6) return;
    setDrag({ dx, dy });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;
    if (drag) {
      setFocus({
        gx: start.focus.gx - Math.round(drag.dx / pitch.x),
        gy: start.focus.gy - Math.round(drag.dy / pitch.y),
      });
      setDrag(null);
      return;
    }
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    const target = {
      gx:
        focus.gx +
        Math.round((event.clientX - rect.left - rect.width / 2) / pitch.x),
      gy:
        focus.gy +
        Math.round((event.clientY - rect.top - rect.height / 2) / pitch.y),
    };
    if (target.gx === focus.gx && target.gy === focus.gy) open();
    else setFocus(target);
  };

  const onWheel = (event: React.WheelEvent) => {
    wheel.current.x += event.deltaX + (event.shiftKey ? event.deltaY : 0);
    wheel.current.y += event.shiftKey ? 0 : event.deltaY;
    const stepX = Math.trunc(wheel.current.x / (pitch.x * 0.6));
    const stepY = Math.trunc(wheel.current.y / (pitch.y * 0.5));
    if (stepX !== 0 || stepY !== 0) {
      wheel.current.x -= stepX * pitch.x * 0.6;
      wheel.current.y -= stepY * pitch.y * 0.5;
      setRepeating(true);
      move({ gx: stepX, gy: stepY });
    }
  };

  const offsetX =
    viewport.width / 2 - focus.gx * pitch.x - pitch.cell / 2 + (drag?.dx ?? 0);
  const offsetY =
    viewport.height / 2 -
    focus.gy * pitch.y -
    (pitch.cell * 1.5) / 2 +
    (drag?.dy ?? 0);

  const tiles: { cell: Cell; key: string }[] = [];
  for (let gy = range.y0; gy <= range.y1; gy++) {
    for (let gx = range.x0; gx <= range.x1; gx++) {
      tiles.push({ cell: { gx, gy }, key: `${gx},${gy}` });
    }
  }

  const highlight = focused ? highlights.get(focused.id) : undefined;

  if (failed) {
    return (
      <div className="grid h-full place-items-center px-6">
        <p className="max-w-md text-center text-2xl text-paper/60">
          The map couldn't load just now. Please try again in a moment.
        </p>
      </div>
    );
  }

  if (meta && meta.width * meta.height <= 1) {
    return (
      <div className="grid h-full place-items-center px-6">
        <p className="max-w-md text-center text-2xl text-paper/60">
          The map fills in once the catalogue has loaded.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div
        ref={surface}
        role="application"
        aria-roledescription="title grid"
        aria-label="Browse every title. Arrow keys move, Enter opens, Escape goes to the menu."
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the grid is one focus stop that owns the arrow keys, like a canvas application.
        tabIndex={0}
        data-nav
        data-nav-own="all"
        data-nav-autofocus
        onKeyDown={onKeyDown}
        onKeyUp={() => setRepeating(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragStart.current = null;
          setDrag(null);
        }}
        onWheel={onWheel}
        className="absolute inset-0 cursor-grab touch-none select-none outline-none active:cursor-grabbing"
      >
        <div
          className={`absolute top-0 left-0 will-change-transform ${drag ? "" : repeating ? "transition-transform duration-150 ease-linear" : "transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"}`}
          style={{ transform: `translate3d(${offsetX}px, ${offsetY}px, 0)` }}
        >
          {tiles.map(({ cell, key }) => {
            const title = titleAt(cell);
            const isFocus = cell.gx === focus.gx && cell.gy === focus.gy;
            return (
              <div
                key={key}
                className="absolute top-0 left-0"
                style={{
                  transform: `translate3d(${cell.gx * pitch.x}px, ${cell.gy * pitch.y}px, 0)`,
                }}
              >
                <Tile
                  title={title}
                  focused={isFocus}
                  highlight={title ? highlights.get(title.id) : undefined}
                  width={pitch.cell}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-ink via-ink/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-ink via-ink/85 to-transparent" />

      {region ? (
        <p
          key={region.genre}
          aria-hidden
          className="pointer-events-none absolute top-20 left-5 animate-rise font-display text-6xl text-paper/90 md:left-10 md:text-8xl"
        >
          {region.genre}
        </p>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-10 md:pb-8">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-end justify-between gap-6">
          <div aria-live="polite" className="min-w-0 max-w-3xl">
            {focused ? (
              <>
                <h2 className="truncate font-display text-5xl md:text-6xl">
                  {focused.title}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-paper/70">
                  <Rating value={focused.rating} className="font-bold" />
                  <span>{focused.type === "movie" ? "Film" : "Series"}</span>
                  <span>
                    {titleYears({
                      ...focused,
                      startYear: focused.year,
                      endYear: null,
                    })}
                  </span>
                  {highlight ? (
                    <span className="flex items-center gap-1.5 font-bold text-amber">
                      {(() => {
                        const { Icon, label } = BADGE[highlight.kind];
                        return (
                          <>
                            <Icon
                              className="size-4"
                              strokeWidth={2.25}
                              aria-hidden
                            />
                            {label}
                          </>
                        );
                      })()}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="h-20" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="radiogroup"
              aria-label="Show"
              className="flex gap-1 rounded-full bg-raised/80 p-1 backdrop-blur-sm"
            >
              {KINDS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={kind === option.value}
                  data-nav
                  onClick={() => setKind(option.value)}
                  className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${kind === option.value ? "bg-paper text-ink" : "text-paper/65 hover:text-paper"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              data-nav
              onClick={() => meta && setFocus(meta.start)}
              className="flex items-center gap-2 rounded-full bg-raised/80 px-4 py-2.5 text-sm font-bold text-paper/80 backdrop-blur-sm transition-colors hover:text-paper"
            >
              <LocateFixed className="size-4" strokeWidth={2} aria-hidden />
              Back to start
            </button>
          </div>
        </div>
        <p className="mx-auto mt-4 flex max-w-[1600px] items-center gap-4 text-sm text-paper/40">
          <span className="flex items-center gap-1.5">
            <Move className="size-4" strokeWidth={1.75} aria-hidden />
            {tv ? "Arrows to move" : "Arrows, drag or scroll to move"}
          </span>
          <span className="flex items-center gap-1.5">
            <CornerDownLeft className="size-4" strokeWidth={1.75} aria-hidden />
            {tv ? "OK to open" : "Enter or click to open"}
          </span>
        </p>
      </div>
    </div>
  );
}
