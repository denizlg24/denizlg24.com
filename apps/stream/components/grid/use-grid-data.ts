"use client";

import {
  type GridMeta,
  type GridTitle,
  gridMetaSchema,
  gridWindowSchema,
  type MapHighlight,
  mapHighlightsSchema,
} from "@repo/schemas/stream";
import { useCallback, useEffect, useRef, useState } from "react";

import { BLOCK, blocksFor, wrap } from "@/components/grid/grid-math";

export type Kind = "movie" | "series" | null;

/**
 * Meta, highlights and lattice blocks for one audience and kind. Blocks are
 * keyed on the wrapped lattice, so walking all the way round reuses them.
 */
export function useGridData({
  profiles,
  kind,
  focusId,
}: {
  profiles: string;
  kind: Kind;
  focusId: string | null;
}) {
  const [meta, setMeta] = useState<GridMeta | null>(null);
  const [failed, setFailed] = useState(false);
  const [highlights, setHighlights] = useState<Map<string, MapHighlight>>(
    () => new Map(),
  );
  const [, setVersion] = useState(0);
  const cells = useRef(new Map<string, GridTitle>());
  const loaded = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const generation = useRef(0);

  const base = `profiles=${encodeURIComponent(profiles)}${kind ? `&type=${kind}` : ""}`;

  useEffect(() => {
    const current = ++generation.current;
    cells.current = new Map();
    loaded.current = new Set();
    pending.current = new Set();
    setMeta(null);
    setFailed(false);
    const controller = new AbortController();
    fetch(`/api/v1/grid/meta?${base}${focusId ? `&focus=${focusId}` : ""}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const parsed = gridMetaSchema.parse(await response.json());
        if (generation.current === current) setMeta(parsed);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [base, focusId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/grid/highlights?profiles=${encodeURIComponent(profiles)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const { highlights: list } = mapHighlightsSchema.parse(
          await response.json(),
        );
        setHighlights(new Map(list.map((item) => [item.id, item])));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [profiles]);

  const ensure = useCallback(
    (range: { x0: number; x1: number; y0: number; y1: number }) => {
      if (!meta) return;
      const size = { width: meta.width, height: meta.height };
      const current = generation.current;
      for (const { bx, by } of blocksFor(range, size)) {
        const key = `${bx},${by}`;
        if (loaded.current.has(key) || pending.current.has(key)) continue;
        pending.current.add(key);
        const x0 = bx * BLOCK.w;
        const y0 = by * BLOCK.h;
        const x1 = Math.min(x0 + BLOCK.w, meta.width) - 1;
        const y1 = Math.min(y0 + BLOCK.h, meta.height) - 1;
        fetch(`/api/v1/grid?${base}&x0=${x0}&y0=${y0}&x1=${x1}&y1=${y1}`)
          .then(async (response) => {
            if (!response.ok) throw new Error(String(response.status));
            const { cells: list } = gridWindowSchema.parse(
              await response.json(),
            );
            if (generation.current !== current) return;
            for (const cell of list) {
              cells.current.set(
                `${wrap(cell.gx, meta.width)},${wrap(cell.gy, meta.height)}`,
                cell.title,
              );
            }
            loaded.current.add(key);
            setVersion((version) => version + 1);
          })
          .catch(() => {})
          .finally(() => pending.current.delete(key));
      }
    },
    [meta, base],
  );

  return { meta, failed, highlights, cells: cells.current, ensure };
}
