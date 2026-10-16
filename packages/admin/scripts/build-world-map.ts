/**
 * Pre-projects Natural Earth countries (world-atlas) into SVG path strings
 * for the explored map: `bun run build:world-map` from packages/admin.
 *
 * Shipping strings instead of TopoJSON keeps topojson out of the bundle and
 * keeps TypeScript from inferring a type for a 3.6 MB JSON literal.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { feature, mesh } from "topojson-client";
import { presimplify, quantile, simplify } from "topojson-simplify";
import type { GeometryCollection, Topology } from "topojson-specification";
import {
  projectX,
  projectY,
  type WorldCountry,
} from "../src/location/mercator";

const require = createRequire(import.meta.url);
const out = join(import.meta.dir, "../src/location/generated");

/**
 * `step` rounds in world units; `keep` is the share of arc vertices kept.
 * Simplifying arcs rather than rings keeps shared borders seamless.
 */
const LEVELS = [
  { resolution: "50m", step: 0.04, keep: 0.5 },
  { resolution: "10m", step: 0.01, keep: 0.35 },
] as const;

/**
 * Natural Earth rings that cross the antimeridian (Chukotka, Fiji) jump from
 * 180 to -180 between neighbours, which Mercator draws as a band across the
 * world. Shifting by whole turns keeps them continuous, past the world's edge
 * where the map clips them. Antarctica's ring runs along the pole from 180 to
 * -180 on purpose, so jumps at the pole stay.
 */
function unwrap(line: Position[]): Position[] {
  let offset = 0;
  let previous: Position | undefined;
  return line.map((position) => {
    const [longitude = 0, latitude = 0] = position;
    if (previous) {
      const [previousLongitude = 0, previousLatitude = 0] = previous;
      const jump = longitude + offset - previousLongitude;
      const polar = Math.abs(latitude) > 89 && Math.abs(previousLatitude) > 89;
      if (!polar && jump > 180) offset -= 360;
      if (!polar && jump < -180) offset += 360;
    }
    previous = [longitude + offset, latitude];
    return previous;
  });
}

function pathFor(lines: Position[][], step: number, close: boolean) {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const round = (value: number) => Math.round(value / step);
  const format = (units: number) => Number((units * step).toFixed(decimals));
  let d = "";
  for (const line of lines) {
    let previous: [number, number] | null = null;
    let segment = "";
    let count = 0;
    for (const [longitude, latitude] of line) {
      const point: [number, number] = [
        round(projectX(longitude ?? 0)),
        round(projectY(latitude ?? 0)),
      ];
      if (!previous) {
        segment = `M${format(point[0])} ${format(point[1])}`;
      } else {
        const dx = point[0] - previous[0];
        const dy = point[1] - previous[1];
        if (dx === 0 && dy === 0) continue;
        segment += `l${format(dx)} ${format(dy)}`;
      }
      previous = point;
      count += 1;
    }
    if (count >= (close ? 3 : 2)) d += close ? `${segment}z` : segment;
  }
  return d;
}

function bboxOf(rings: Position[][]): WorldCountry["bbox"] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const [longitude, latitude] of ring) {
      const x = projectX(longitude ?? 0);
      const y = projectY(latitude ?? 0);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return [minX, minY, maxX, maxY].map(
    (value) => Math.round(value * 100) / 100,
  ) as WorldCountry["bbox"];
}

for (const { resolution, step, keep } of LEVELS) {
  const source = JSON.parse(
    readFileSync(
      require.resolve(`world-atlas/countries-${resolution}.json`),
      "utf8",
    ),
  ) as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const presimplified = presimplify(source);
  const topology = simplify(
    presimplified,
    quantile(presimplified, keep),
  ) as typeof source;
  const collection = feature(topology, topology.objects.countries);
  const countries: WorldCountry[] = [];
  for (const country of collection.features) {
    const geometry = country.geometry as Polygon | MultiPolygon | null;
    if (!geometry) continue;
    const rings = (
      geometry.type === "Polygon"
        ? geometry.coordinates
        : geometry.coordinates.flat()
    ).map(unwrap);
    const d = pathFor(rings, step, true);
    if (!d) continue;
    countries.push({
      name: country.properties?.name ?? "",
      bbox: bboxOf(rings),
      d,
    });
  }
  const borders = mesh(topology, topology.objects.countries, (a, b) => a !== b);
  const data = {
    countries,
    borders: pathFor(borders.coordinates.map(unwrap), step, false),
  };
  const file = join(out, `world-${resolution}.ts`);
  writeFileSync(
    file,
    `// Generated by scripts/build-world-map.ts from world-atlas (Natural Earth, public domain).\nimport type { WorldMapData } from "../mercator";\n\nconst data: WorldMapData = ${JSON.stringify(data)};\n\nexport default data;\n`,
  );
  console.log(
    `${resolution}: ${countries.length} countries, ${(readFileSync(file).length / 1024).toFixed(0)} KB`,
  );
}
