/**
 * Web Mercator onto a square world `WORLD_SIZE` units across, shared by the
 * map data generator (`scripts/build-world-map.ts`) and the explored map, so
 * the pre-projected coastlines and the live tracks land on the same plane.
 */
export const WORLD_SIZE = 1024;
export const MAX_LATITUDE = 85.051_128_78;
export const EARTH_CIRCUMFERENCE_METRES = 40_075_016.686;

export interface WorldCountry {
  name: string;
  /** [minX, minY, maxX, maxY] in world units. */
  bbox: [number, number, number, number];
  /** SVG path data in world units. */
  d: string;
}

export interface WorldMapData {
  countries: WorldCountry[];
  /** Land borders between countries, as one path. */
  borders: string;
}

export function projectX(longitude: number) {
  return ((longitude + 180) / 360) * WORLD_SIZE;
}

export function projectY(latitude: number) {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  const phi = (clamped * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * WORLD_SIZE
  );
}

export function unprojectLongitude(x: number) {
  return (x / WORLD_SIZE) * 360 - 180;
}

export function unprojectLatitude(y: number) {
  const n = Math.PI * (1 - (2 * y) / WORLD_SIZE);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** World units per metre on the ground at a latitude. */
export function unitsPerMetre(latitude: number) {
  return (
    WORLD_SIZE /
    (EARTH_CIRCUMFERENCE_METRES * Math.cos((latitude * Math.PI) / 180))
  );
}
