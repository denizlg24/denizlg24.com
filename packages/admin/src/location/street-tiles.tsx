"use client";

import { type MapTile, type MapTileLayer, mapTileSchema } from "@repo/schemas";
import { useEffect, useRef, useState } from "react";
import { useAdmin } from "../provider";
import { WORLD_SIZE } from "./mercator";

/**
 * OpenStreetMap streets, water, parks and buildings under the explored layer,
 * from city zoom down. Tiles come from web's `/location/tiles`, already
 * decoded into one path per layer; anything not loaded yet falls back to the
 * nearest loaded ancestor, then to the Natural Earth land beneath.
 */

/** Below this the tiles would be noise at world scale; Natural Earth shows. */
const MIN_ZOOM = 9;
const MAX_ZOOM = 14;
const MAX_TILES = 48;
const ANCESTORS = 4;

export const MAP_WATER =
  "color-mix(in oklab, var(--secondary) 45%, var(--background))";
const LAND = "var(--muted)";
const WOOD = "color-mix(in oklab, var(--accent) 50%, var(--muted))";
const PARK = "color-mix(in oklab, var(--accent) 30%, var(--muted))";
const BUILDING = "color-mix(in oklab, var(--foreground) 14%, var(--muted))";
const ROAD = "var(--background)";
const RAIL = "var(--muted-foreground)";

const FILLS: [MapTileLayer, string][] = [
  ["wood", WOOD],
  ["park", PARK],
  ["water", MAP_WATER],
  ["building", BUILDING],
];

/** Stroke widths in px at z14; widened when zoomed past it. */
const STROKES: [MapTileLayer, string, number, string?][] = [
  ["waterway", MAP_WATER, 1.5],
  ["path", ROAD, 0.8, "2 1.5"],
  ["rail", RAIL, 0.8, "3 2"],
  ["minor", ROAD, 1.6],
  ["street", ROAD, 2.6],
  ["major", ROAD, 3.6],
];

interface View {
  scale: number;
  x: number;
  y: number;
}

type TileKey = `${number}/${number}/${number}`;

function key(z: number, x: number, y: number): TileKey {
  return `${z}/${x}/${y}`;
}

function TileShapes({
  tile,
  transform,
  strokeScale,
}: {
  tile: MapTile;
  transform: string;
  strokeScale: number;
}) {
  return (
    <g transform={transform} strokeLinecap="round" strokeLinejoin="round">
      <rect
        width={tile.extent}
        height={tile.extent}
        fill={LAND}
        shapeRendering="crispEdges"
      />
      {FILLS.map(([layer, fill]) =>
        tile.layers[layer] ? (
          <path key={layer} d={tile.layers[layer]} fill={fill} />
        ) : null,
      )}
      {STROKES.map(([layer, stroke, width, dash]) =>
        tile.layers[layer] ? (
          <path
            key={layer}
            d={tile.layers[layer]}
            fill="none"
            stroke={stroke}
            strokeWidth={width * strokeScale}
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
    </g>
  );
}

export function StreetTiles({
  view,
  width,
  height,
}: {
  view: View;
  width: number;
  height: number;
}) {
  const { client } = useAdmin();
  const tiles = useRef(new Map<TileKey, MapTile>());
  const pending = useRef(new Set<TileKey>());
  const [, setLoaded] = useState(0);

  // A tile about 512 px across on screen.
  const ideal = Math.round(Math.log2(view.scale * 2));
  const zoom = Math.min(MAX_ZOOM, ideal);
  const active = ideal >= MIN_ZOOM && width > 0;
  const tileWorld = WORLD_SIZE / 2 ** zoom;
  const span = 2 ** zoom;
  const x0 = Math.max(0, Math.floor(-view.x / view.scale / tileWorld));
  const y0 = Math.max(0, Math.floor(-view.y / view.scale / tileWorld));
  const x1 = Math.min(
    span - 1,
    Math.floor((width - view.x) / view.scale / tileWorld),
  );
  const y1 = Math.min(
    span - 1,
    Math.floor((height - view.y) / view.scale / tileWorld),
  );
  const wanted: [number, number][] = [];
  if (active) {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) wanted.push([x, y]);
    }
  }
  const visible = wanted.length <= MAX_TILES ? wanted : [];
  const wantedKeys = visible.map(([x, y]) => key(zoom, x, y)).join(",");

  useEffect(() => {
    if (!wantedKeys) return;
    for (const tileKey of wantedKeys.split(",") as TileKey[]) {
      if (tiles.current.has(tileKey) || pending.current.has(tileKey)) continue;
      pending.current.add(tileKey);
      client
        .get<unknown>(`location/tiles/${tileKey}`)
        .then((response) => {
          tiles.current.set(tileKey, mapTileSchema.parse(response));
          setLoaded((count) => count + 1);
        })
        .catch(() => undefined)
        .finally(() => pending.current.delete(tileKey));
    }
  }, [client, wantedKeys]);

  if (!visible.length) return null;

  // Past z14 the same tile is drawn bigger; the roads should widen with it.
  const strokeScale = Math.min(4, Math.max(1, 2 ** (ideal - MAX_ZOOM)));
  const placed = new Map<
    TileKey,
    { tile: MapTile; z: number; x: number; y: number }
  >();
  const exact: TileKey[] = [];
  for (const [x, y] of visible) {
    const own = key(zoom, x, y);
    const tile = tiles.current.get(own);
    if (tile) {
      placed.set(own, { tile, z: zoom, x, y });
      exact.push(own);
      continue;
    }
    for (let up = 1; up <= ANCESTORS && zoom - up >= 0; up += 1) {
      const z = zoom - up;
      const ax = x >> up;
      const ay = y >> up;
      const ancestor = tiles.current.get(key(z, ax, ay));
      if (ancestor) {
        placed.set(key(z, ax, ay), { tile: ancestor, z, x: ax, y: ay });
        break;
      }
    }
  }
  const order = [...placed.keys()].sort(
    (a, b) => Number(exact.includes(a)) - Number(exact.includes(b)),
  );

  return (
    <g>
      {order.map((tileKey) => {
        const entry = placed.get(tileKey);
        if (!entry) return null;
        const size = WORLD_SIZE / 2 ** entry.z;
        // Composed here in doubles: at street zoom the world offset is tens
        // of millions of pixels, which float32 inside the SVG would smear.
        const transform = `translate(${view.x + view.scale * entry.x * size} ${view.y + view.scale * entry.y * size}) scale(${(view.scale * size) / entry.tile.extent})`;
        return (
          <TileShapes
            key={tileKey}
            tile={entry.tile}
            transform={transform}
            strokeScale={strokeScale}
          />
        );
      })}
    </g>
  );
}
