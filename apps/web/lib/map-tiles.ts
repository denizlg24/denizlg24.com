import { VectorTile } from "@mapbox/vector-tile";
import type { MapTile, MapTileLayer } from "@repo/schemas";
import Pbf from "pbf";

/**
 * Street-level basemap for the explored map: OpenFreeMap's OpenStreetMap
 * vector tiles, fetched by this server and decoded into one SVG path per
 * layer. Going through the server means the tile host sees this server, never
 * the browser, and each tile is asked for once per process rather than once
 * per pan.
 */

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
export const MAP_TILE_MAX_ZOOM = 14;
const TEMPLATE_TTL_MS = 24 * 3_600_000;
const CACHE_TILES = 2_000;

let template: { url: string; fetchedAt: number } | null = null;
const cache = new Map<string, MapTile>();

async function tileTemplate() {
  if (template && Date.now() - template.fetchedAt < TEMPLATE_TTL_MS) {
    return template.url;
  }
  const response = await fetch(TILEJSON_URL);
  if (!response.ok) throw new Error(`TileJSON ${response.status}`);
  const json = (await response.json()) as { tiles?: string[] };
  const url = json.tiles?.[0];
  if (!url) throw new Error("TileJSON has no tile URL");
  template = { url, fetchedAt: Date.now() };
  return url;
}

const ROAD_LAYERS: Record<string, MapTileLayer> = {
  motorway: "major",
  trunk: "major",
  primary: "major",
  secondary: "street",
  tertiary: "street",
  minor: "minor",
  service: "minor",
  track: "path",
  path: "path",
  rail: "rail",
  transit: "rail",
};

const WOOD_CLASSES = new Set(["wood", "forest"]);

function layerFor(
  source: string,
  properties: Record<string, number | string | boolean>,
  type: number,
): MapTileLayer | null {
  const kind = String(properties.class ?? "");
  switch (source) {
    case "water":
      return type === 3 ? "water" : null;
    case "waterway":
      return type === 2 ? "waterway" : null;
    case "park":
      return type === 3 ? "park" : null;
    case "landcover":
      return type === 3 && WOOD_CLASSES.has(kind) ? "wood" : null;
    case "building":
      return type === 3 ? "building" : null;
    case "transportation":
      if (type !== 2 || properties.brunnel === "tunnel") return null;
      return ROAD_LAYERS[kind] ?? null;
    default:
      return null;
  }
}

/** Integer tile units, relative after the first point of each ring. */
function pathData(rings: { x: number; y: number }[][], close: boolean) {
  let d = "";
  for (const ring of rings) {
    const first = ring[0];
    if (!first || ring.length < (close ? 3 : 2)) continue;
    d += `M${first.x} ${first.y}`;
    let previous = first;
    for (let index = 1; index < ring.length; index += 1) {
      const point = ring[index];
      if (!point) continue;
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      if (dx === 0 && dy === 0) continue;
      d += `l${dx} ${dy}`;
      previous = point;
    }
    if (close) d += "z";
  }
  return d;
}

export function decodeMapTile(bytes: Uint8Array): MapTile {
  const tile = new VectorTile(new Pbf(bytes));
  const layers: Partial<Record<MapTileLayer, string>> = {};
  let extent = 4_096;
  for (const [source, layer] of Object.entries(tile.layers)) {
    extent = layer.extent;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const target = layerFor(source, feature.properties, feature.type);
      if (!target) continue;
      const d = pathData(feature.loadGeometry(), feature.type === 3);
      if (d) layers[target] = (layers[target] ?? "") + d;
    }
  }
  return { extent, layers };
}

export async function getMapTile(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const url = (await tileTemplate())
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  const response = await fetch(url);
  // An empty stretch of ocean has no tile at all.
  const tile =
    response.status === 404 || response.status === 204
      ? { extent: 4_096, layers: {} }
      : response.ok
        ? decodeMapTile(new Uint8Array(await response.arrayBuffer()))
        : null;
  if (!tile) throw new Error(`tile ${key}: ${response.status}`);
  cache.set(key, tile);
  if (cache.size > CACHE_TILES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return tile;
}
