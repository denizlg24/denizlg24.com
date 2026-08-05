"use client";

import type { Position } from "@repo/markets/schemas";
import { useEffect, useMemo, useRef, useState } from "react";

export interface PositionTreemapProps {
  positions: Position[];
  cash: number;
  height?: number;
  onSelect?: (ticker: string) => void;
}

interface Tile {
  ticker: string;
  /** Area weight: exposure. Never negative, so the layout is always valid. */
  value: number;
  /** Colour weight: the position's own return, in percent. */
  changePercent: number | null;
  isCash: boolean;
  isShort: boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Area is position size and colour is that position's return, so the two things
 * worth knowing about a book — where the money sits and what it is doing — are
 * legible in one glance. A diverging red/grey/green ramp carries the sign; the
 * ticker and its numbers are printed on every tile that can fit them, so colour
 * is never the only channel.
 */
export function PositionTreemap({
  positions,
  cash,
  height = 260,
  onSelect,
}: PositionTreemapProps) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const tiles = useMemo<Tile[]>(() => {
    // Sized by exposure, so a short takes the area its risk deserves. Its market
    // value is negative and would otherwise either invert the layout or drop the
    // position off the map entirely.
    const open: Tile[] = positions
      .filter((position) => position.quantity !== 0 && position.exposure > 0)
      .map((position) => ({
        ticker: position.ticker,
        value: position.exposure,
        changePercent: position.unrealizedPnlPercent,
        isCash: false,
        isShort: position.quantity < 0,
      }));
    // Cash is part of what the portfolio is made of; omitting it would make a
    // mostly-uninvested book look fully deployed.
    if (cash > 0) {
      open.push({
        ticker: "CASH",
        value: cash,
        changePercent: null,
        isCash: true,
        isShort: false,
      });
    }
    return open.sort((a, b) => b.value - a.value);
  }, [positions, cash]);

  const laid = useMemo(
    () =>
      width > 0
        ? squarify(tiles, { x: 0, y: 0, width, height })
        : ([] as (Rect & { tile: Tile })[]),
    [tiles, width, height],
  );

  const total = tiles.reduce((sum, tile) => sum + tile.value, 0);

  return (
    <div ref={container} className="w-full">
      {laid.length === 0 ? (
        <div
          className="flex items-center justify-center text-muted-foreground text-xs"
          style={{ height }}
        >
          —
        </div>
      ) : (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Positions by exposure"
        >
          <title>Positions by exposure</title>
          {laid.map(({ tile, ...rect }) => {
            const share = total === 0 ? 0 : tile.value / total;
            const canLabel = rect.width > 44 && rect.height > 26;
            const canDetail = rect.width > 64 && rect.height > 44;
            return (
              // An SVG group is not focusable and carries no role, so an
              // interactive tile has to declare both or it is reachable only
              // by pointer.
              <g
                key={tile.ticker}
                onMouseEnter={() => setHovered(tile.ticker)}
                onMouseLeave={() => setHovered(null)}
                onClick={
                  tile.isCash ? undefined : () => onSelect?.(tile.ticker)
                }
                onKeyDown={
                  tile.isCash
                    ? undefined
                    : (event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onSelect?.(tile.ticker);
                      }
                }
                onFocus={() => setHovered(tile.ticker)}
                onBlur={() => setHovered(null)}
                role={tile.isCash ? undefined : "button"}
                tabIndex={tile.isCash ? undefined : 0}
                aria-label={
                  tile.isCash
                    ? undefined
                    : // The side is carried by a dash pattern and an arrow, so
                      // without it here a screen reader cannot tell a short from
                      // a long at all.
                      `${tile.ticker} ${tile.isShort ? "short" : "long"}, ${(share * 100).toFixed(1)}% of portfolio`
                }
                className={tile.isCash ? undefined : "cursor-pointer"}
              >
                <rect
                  x={rect.x + 1}
                  y={rect.y + 1}
                  width={Math.max(0, rect.width - 2)}
                  height={Math.max(0, rect.height - 2)}
                  rx={2}
                  fill={fillFor(tile)}
                  stroke={
                    hovered === tile.ticker
                      ? "currentColor"
                      : "rgba(127,127,127,0.25)"
                  }
                  // A short is dashed as well as labelled. Colour already
                  // carries the return and cannot also carry the side, and a
                  // short tile shaded green for a gain is exactly the tile that
                  // must not read as a long.
                  strokeDasharray={tile.isShort ? "3 2" : undefined}
                  strokeWidth={hovered === tile.ticker ? 1.5 : 0.5}
                />
                {canLabel ? (
                  <text
                    x={rect.x + 7}
                    y={rect.y + 16}
                    className="fill-foreground font-medium text-[11px]"
                  >
                    {tile.isShort ? `${tile.ticker} ↓` : tile.ticker}
                  </text>
                ) : null}
                {canLabel ? (
                  <text
                    x={rect.x + 7}
                    y={rect.y + 28}
                    className="fill-muted-foreground text-[10px] tabular-nums"
                  >
                    {(share * 100).toFixed(1)}%
                  </text>
                ) : null}
                {canDetail && tile.changePercent !== null ? (
                  <text
                    x={rect.x + 7}
                    y={rect.y + 41}
                    className="fill-foreground text-[10px] tabular-nums"
                  >
                    {tile.changePercent >= 0 ? "+" : ""}
                    {tile.changePercent.toFixed(1)}%
                  </text>
                ) : null}
                <title>
                  {`${tile.ticker}${tile.isShort ? " (short)" : ""} · ${(share * 100).toFixed(1)}% of book · ${tile.value.toLocaleString(
                    "en-GB",
                    { maximumFractionDigits: 0 },
                  )}${
                    tile.changePercent === null
                      ? ""
                      : ` · ${tile.changePercent >= 0 ? "+" : ""}${tile.changePercent.toFixed(2)}%`
                  }`}
                </title>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/**
 * Diverging ramp around a neutral midpoint. Saturation saturates at ±25% so one
 * runaway holding cannot flatten every other tile into the same washed-out band.
 */
function fillFor(tile: Tile): string {
  if (tile.isCash || tile.changePercent === null) {
    return "rgba(127,127,127,0.18)";
  }
  const intensity = Math.min(Math.abs(tile.changePercent) / 25, 1);
  const alpha = 0.12 + intensity * 0.5;
  return tile.changePercent >= 0
    ? `rgba(22,163,74,${alpha.toFixed(3)})`
    : `rgba(220,38,38,${alpha.toFixed(3)})`;
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk). Rows are laid along whichever
 * side is currently shorter and a row is closed as soon as adding the next tile
 * would make its worst aspect ratio worse, which keeps tiles near-square and so
 * keeps their areas comparable by eye.
 */
function squarify(tiles: Tile[], rect: Rect): (Rect & { tile: Tile })[] {
  const total = tiles.reduce((sum, tile) => sum + tile.value, 0);
  if (total <= 0 || rect.width <= 0 || rect.height <= 0) return [];

  const scale = (rect.width * rect.height) / total;
  const queue = tiles.map((tile) => ({ tile, area: tile.value * scale }));
  const out: (Rect & { tile: Tile })[] = [];

  let { x, y, width, height } = rect;

  while (queue.length > 0) {
    const side = Math.min(width, height);
    if (side <= 0) break;

    const row: { tile: Tile; area: number }[] = [];
    let rowArea = 0;
    let best = Number.POSITIVE_INFINITY;

    while (queue.length > 0) {
      const next = queue[0] as { tile: Tile; area: number };
      const ratio = worstRatio([...row, next], rowArea + next.area, side);
      if (row.length > 0 && ratio > best) break;
      queue.shift();
      row.push(next);
      rowArea += next.area;
      best = ratio;
    }

    const thickness = rowArea / side;
    let offset = 0;
    const horizontal = width >= height;

    for (const entry of row) {
      const length = thickness === 0 ? 0 : entry.area / thickness;
      out.push(
        horizontal
          ? {
              tile: entry.tile,
              x,
              y: y + offset,
              width: thickness,
              height: length,
            }
          : {
              tile: entry.tile,
              x: x + offset,
              y,
              width: length,
              height: thickness,
            },
      );
      offset += length;
    }

    if (horizontal) {
      x += thickness;
      width -= thickness;
    } else {
      y += thickness;
      height -= thickness;
    }
  }

  return out;
}

function worstRatio(
  row: { area: number }[],
  rowArea: number,
  side: number,
): number {
  if (rowArea <= 0) return Number.POSITIVE_INFINITY;
  const thickness = rowArea / side;
  let worst = 0;
  for (const entry of row) {
    if (entry.area <= 0) continue;
    const length = entry.area / thickness;
    worst = Math.max(worst, thickness / length, length / thickness);
  }
  return worst;
}
