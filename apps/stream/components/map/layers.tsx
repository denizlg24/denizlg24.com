"use client";

import {
  type MapHighlight,
  type MapPoint,
  tmdbImage,
} from "@repo/schemas/stream";
import Link from "next/link";
import { memo, type Ref } from "react";

import type { Anchor, PosterTile } from "./layout";

/** Font size of a genre name, in map units: it grows and shrinks with the map. */
export const LABEL_SIZE = 380;

export const GenreLabels = memo(function GenreLabels({
  anchors,
  ref,
}: {
  anchors: readonly Anchor[];
  ref: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} aria-hidden className="pointer-events-none">
      {anchors.map((anchor) => (
        <span
          key={anchor.genre}
          className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-display text-paper/[0.13] leading-none"
          style={{ left: anchor.x, top: anchor.y, fontSize: LABEL_SIZE }}
        >
          {anchor.genre}
        </span>
      ))}
    </div>
  );
});

function revealOnLoad(image: HTMLImageElement | null) {
  if (image?.complete && image.naturalWidth > 0) image.style.opacity = "1";
}

export const PosterLayer = memo(function PosterLayer({
  tiles,
  ref,
}: {
  tiles: readonly PosterTile[];
  ref: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} aria-hidden className="pointer-events-none">
      {tiles.map(({ point, left, top, width, height }) => {
        const src = tmdbImage(point.posterPath, "w185");
        const radius = width * 0.04;
        return (
          <div
            key={point.id}
            className="absolute"
            style={{ left, top, width, height }}
          >
            {src ? (
              <img
                ref={revealOnLoad}
                src={src}
                alt=""
                decoding="async"
                draggable={false}
                onLoad={(event) => {
                  event.currentTarget.style.opacity = "1";
                }}
                className="size-full bg-lift object-cover opacity-0 transition-opacity duration-500"
                style={{
                  borderRadius: radius,
                  outline: `${width * 0.01}px solid rgb(239 233 223 / 0.1)`,
                  outlineOffset: -width * 0.01,
                }}
              />
            ) : (
              <div
                className="flex size-full items-end bg-lift font-display text-muted leading-tight"
                style={{
                  borderRadius: radius,
                  padding: width * 0.09,
                  fontSize: width * 0.14,
                  outline: `${width * 0.01}px solid rgb(239 233 223 / 0.1)`,
                  outlineOffset: -width * 0.01,
                }}
              >
                <span className="line-clamp-4">{point.title}</span>
              </div>
            )}
            <div
              className="absolute inset-x-0 truncate text-center text-paper/80"
              style={{
                top: height + width * 0.05,
                fontSize: width * 0.105,
                opacity: "var(--caption, 0)",
              }}
            >
              {point.title}
            </div>
          </div>
        );
      })}
    </div>
  );
});

function Ring({
  x,
  y,
  size,
  strong = false,
}: {
  x: number;
  y: number;
  size: number;
  strong?: boolean;
}) {
  return (
    <span
      className="absolute"
      style={{
        left: x,
        top: y,
        width: size,
        height: size,
        transform: "translate(-50%, -50%) scale(var(--inv, 1))",
      }}
    >
      <span
        className={`absolute inset-0 rounded-full border ${strong ? "border-2 border-amber" : "border-amber/50"}`}
      />
      <span className="absolute inset-0 animate-pulse-ring rounded-full border border-amber" />
    </span>
  );
}

export const PickedRings = memo(function PickedRings({
  highlights,
}: {
  highlights: readonly MapHighlight[];
}) {
  return (
    <div aria-hidden className="pointer-events-none">
      {highlights
        .filter((highlight) => highlight.kind === "picked")
        .map((highlight) => (
          <Ring key={highlight.id} x={highlight.x} y={highlight.y} size={26} />
        ))}
    </div>
  );
});

export function FocusRing({ x, y }: { x: number; y: number }) {
  return (
    <div aria-hidden className="pointer-events-none">
      <Ring x={x} y={y} size={150} strong />
    </div>
  );
}

export const VisibleList = memo(function VisibleList({
  points,
}: {
  points: readonly MapPoint[];
}) {
  return (
    <nav aria-label="Titles in view" className="sr-only">
      <ul>
        {points.map((point) => (
          <li key={point.id}>
            <Link href={`/title/${point.id}`} tabIndex={-1}>
              {point.title}
              {point.year ? `, ${point.year}` : ""}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
});
