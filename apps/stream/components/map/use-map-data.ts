"use client";

import {
  type MapHighlight,
  type MapMeta,
  type MapPoint,
  mapHighlightsSchema,
  mapMetaSchema,
  mapRegionSchema,
  titleSummarySchema,
} from "@repo/schemas/stream";
import { useEffect, useState } from "react";
import { z } from "zod";

import type { Tile } from "./camera";
import type { MapKind, TileLoader } from "./region-store";

const API = "/api/v1";

export async function getJson<S extends z.ZodType>(
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.output<S>> {
  const response = await fetch(`${API}${path}`, {
    signal,
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return schema.parse(await response.json());
}

function regionPath(
  bounds: Pick<Tile, "x0" | "y0" | "x1" | "y1">,
  cell: number,
  kind: MapKind | null,
  profile: string | null,
): string {
  const params = new URLSearchParams({
    x0: String(Math.floor(bounds.x0)),
    y0: String(Math.floor(bounds.y0)),
    x1: String(Math.ceil(bounds.x1)),
    y1: String(Math.ceil(bounds.y1)),
    cell: String(cell),
  });
  if (kind) params.set("type", kind);
  if (profile) params.set("profile", profile);
  return `/map?${params}`;
}

export function tileLoader(profile: string | null): TileLoader {
  return async (tile, cell, kind, signal) => {
    const region = await getJson(
      regionPath(tile, cell, kind, profile),
      mapRegionSchema,
      signal,
    );
    return region.points;
  };
}

export type Loadable<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error" };

function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
): [Loadable<T>, () => void] {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal).then(
      (data) => setState({ status: "ready", data }),
      () => {
        if (!controller.signal.aborted) setState({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [key, attempt]);
  return [state, () => setAttempt((n) => n + 1)];
}

export interface MapSetup {
  meta: MapMeta;
  /** The whole map at its coarsest: empty means the catalogue has not loaded yet. */
  empty: boolean;
}

export function useMapSetup(profile: string | null) {
  return useLoad<MapSetup>(async (signal) => {
    const meta = await getJson("/map/meta", mapMetaSchema, signal);
    const overview = await getJson(
      regionPath(
        { x0: 0, y0: 0, x1: meta.size, y1: meta.size },
        Math.max(Math.round(meta.size / 8), 20),
        null,
        profile,
      ),
      mapRegionSchema,
      signal,
    );
    return { meta, empty: overview.points.length === 0 };
  }, profile ?? "");
}

export function useHighlights(profiles: readonly string[]) {
  const key = profiles.join(",");
  const [state] = useLoad<MapHighlight[]>(
    async (signal) =>
      (
        await getJson(
          `/map/highlights?profiles=${encodeURIComponent(key)}`,
          mapHighlightsSchema,
          signal,
        )
      ).highlights,
    key,
  );
  return state;
}

const titleResponseSchema = z.object({ title: titleSummarySchema });

/** A constellation star carries no poster or year; the peek fills them in from the title. */
export async function pointForTitle(
  id: string,
  at: { x: number; y: number },
  signal: AbortSignal,
): Promise<MapPoint> {
  const { title } = await getJson(
    `/titles/${encodeURIComponent(id)}`,
    titleResponseSchema,
    signal,
  );
  return {
    id: title.id,
    x: at.x,
    y: at.y,
    title: title.title,
    type: title.type,
    year: title.startYear,
    rating: title.rating,
    posterPath: title.posterPath,
    weight: 0,
  };
}
