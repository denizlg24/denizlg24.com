"use client";

import {
  type SurfaceCallResult,
  type SurfaceInput,
  type SurfacePatch,
  type SurfaceRevision,
  type SurfaceState,
  surfaceAssetSchema,
  surfaceCallResultSchema,
  surfaceErrorSchema,
  surfaceRevisionSchema,
  type WorkspaceSurface,
  type WorkspaceSurfaceSummary,
  workspaceSurfaceSchema,
  workspaceSurfaceSummarySchema,
} from "@repo/schemas";
import { useEffect } from "react";
import { z } from "zod";
import { create } from "zustand";
import { AdminApiError, type AdminClient } from "../../client";
import { useAdmin } from "../../provider";

export const SURFACES_ROOT = "workspace/surfaces";
const CACHE_SLOT = "denizlg24.surfaces.v1";
const POLL_MS = 60_000;

const listSchema = z.object({
  surfaces: z.array(workspaceSurfaceSummarySchema),
});
const oneSchema = z.object({ surface: workspaceSurfaceSchema });
const historySchema = z.object({ revisions: z.array(surfaceRevisionSchema) });
const stateSchema = z.object({ state: z.record(z.string(), z.unknown()) });
const errorsSchema = z.object({ errors: z.array(surfaceErrorSchema) });
const assetSchema = z.object({
  asset: surfaceAssetSchema,
  surface: workspaceSurfaceSchema,
});

export type LoadedSurface = WorkspaceSurface | "missing";

function path(id: string, ...rest: string[]): string {
  return [SURFACES_ROOT, ...[id, ...rest].map(encodeURIComponent)].join("/");
}

/** The server refused a write made against an older rev; `surface` is what it holds now. */
export class SurfaceConflictError extends Error {
  readonly surface: WorkspaceSurface;

  constructor(surface: WorkspaceSurface) {
    super("Surface changed since it was opened");
    this.name = "SurfaceConflictError";
    this.surface = surface;
  }
}

function conflictOf(error: unknown): WorkspaceSurface | null {
  if (!(error instanceof AdminApiError) || error.code !== 409) return null;
  const parsed = oneSchema.safeParse(error.details);
  return parsed.success ? parsed.data.surface : null;
}

function readCache(): WorkspaceSurfaceSummary[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_SLOT);
    if (!raw) return null;
    const parsed = z
      .array(workspaceSurfaceSummarySchema)
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCache(list: WorkspaceSurfaceSummary[]) {
  try {
    globalThis.localStorage?.setItem(CACHE_SLOT, JSON.stringify(list));
  } catch {
    // Only costs the instant decision on the next launch.
  }
}

interface SurfaceStoreState {
  list: WorkspaceSurfaceSummary[] | null;
  byId: Record<string, LoadedSurface>;
  /** Default UI everywhere until reload or until re-entered. */
  bypass: boolean;
  setBypass: (bypass: boolean) => void;
  /** Fills the list from localStorage; after mount, so web hydrates against the server's markup. */
  hydrateCache: () => void;
  refreshList: (client: AdminClient) => Promise<void>;
  ensure: (client: AdminClient, id: string, force?: boolean) => Promise<void>;
  create: (
    client: AdminClient,
    input: SurfaceInput,
  ) => Promise<WorkspaceSurface>;
  update: (
    client: AdminClient,
    id: string,
    patch: SurfacePatch,
    /** The rev the patch was made against; a newer server copy throws SurfaceConflictError. */
    baseRev: number,
  ) => Promise<WorkspaceSurface>;
  remove: (client: AdminClient, id: string) => Promise<void>;
  history: (client: AdminClient, id: string) => Promise<SurfaceRevision[]>;
  revert: (
    client: AdminClient,
    id: string,
    rev: number,
  ) => Promise<WorkspaceSurface>;
  putState: (
    client: AdminClient,
    id: string,
    state: SurfaceState,
  ) => Promise<SurfaceState>;
  reportErrors: (
    client: AdminClient,
    id: string,
    /** The rev the reporting frame runs; the server drops batches from an older one. */
    rev: number,
    errors: { message: string; source?: string }[],
  ) => Promise<void>;
  clearErrors: (client: AdminClient, id: string) => Promise<void>;
  addAsset: (
    client: AdminClient,
    id: string,
    file: File,
    name: string,
  ) => Promise<WorkspaceSurface>;
  removeAsset: (
    client: AdminClient,
    id: string,
    name: string,
  ) => Promise<WorkspaceSurface>;
  call: (
    client: AdminClient,
    id: string,
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<SurfaceCallResult>;
}

const inflight = new Set<string>();

export const useSurfaceStore = create<SurfaceStoreState>((set, get) => {
  const store = (surface: WorkspaceSurface) =>
    set({ byId: { ...get().byId, [surface.id]: surface } });
  const amend = (id: string, change: Partial<WorkspaceSurface>) => {
    const current = get().byId[id];
    if (!current || current === "missing") return;
    store({ ...current, ...change });
  };
  const setList = (list: WorkspaceSurfaceSummary[]) => {
    set({ list });
    writeCache(list);
  };
  const refreshList = async (client: AdminClient) => {
    const { surfaces } = listSchema.parse(await client.get(SURFACES_ROOT));
    setList(surfaces);
  };

  return {
    list: null,
    byId: {},
    bypass: false,
    setBypass: (bypass) => set({ bypass }),
    hydrateCache: () => {
      if (get().list === null) set({ list: readCache() });
    },
    refreshList,
    ensure: async (client, id, force = false) => {
      if (!id || inflight.has(id) || (!force && get().byId[id])) return;
      inflight.add(id);
      try {
        const { surface } = oneSchema.parse(await client.get(path(id)));
        store(surface);
      } catch (error) {
        const gone = error instanceof AdminApiError && error.code === 404;
        // A transient failure keeps whatever was shown; with nothing to show,
        // "missing" falls back to the default UI and useSurface retries it
        // on the next list refresh while the list still names the surface.
        if (gone || !get().byId[id]) {
          set({ byId: { ...get().byId, [id]: "missing" } });
        }
      } finally {
        inflight.delete(id);
      }
    },
    create: async (client, input) => {
      const { surface } = oneSchema.parse(
        await client.post(SURFACES_ROOT, input),
      );
      store(surface);
      await refreshList(client);
      return surface;
    },
    update: async (client, id, patch, baseRev) => {
      let response: unknown;
      try {
        response = await client.patch(path(id), { ...patch, baseRev });
      } catch (error) {
        const current = conflictOf(error);
        if (!current) throw error;
        store(current);
        void refreshList(client).catch(() => {});
        throw new SurfaceConflictError(current);
      }
      const { surface } = oneSchema.parse(response);
      store(surface);
      await refreshList(client);
      return surface;
    },
    remove: async (client, id) => {
      await client.del(path(id));
      const { [id]: _gone, ...rest } = get().byId;
      set({ byId: rest });
      await refreshList(client);
    },
    history: async (client, id) =>
      historySchema.parse(await client.get(`${path(id, "history")}?limit=50`))
        .revisions,
    revert: async (client, id, rev) => {
      const { surface } = oneSchema.parse(
        await client.post(path(id, "revert"), { rev }),
      );
      store(surface);
      await refreshList(client);
      return surface;
    },
    putState: async (client, id, state) => {
      const saved = stateSchema.parse(
        await client.put(path(id, "state"), { state }),
      ).state;
      amend(id, { state: saved });
      return saved;
    },
    reportErrors: async (client, id, rev, errors) => {
      const saved = errorsSchema.parse(
        await client.post(path(id, "errors"), { rev, errors }),
      ).errors;
      const current = get().byId[id];
      if (current && current !== "missing" && current.rev === rev) {
        amend(id, { errors: saved });
      }
    },
    clearErrors: async (client, id) => {
      await client.del(path(id, "errors"));
      amend(id, { errors: [] });
    },
    addAsset: async (client, id, file, name) => {
      const form = new FormData();
      form.set("file", file);
      form.set("name", name);
      const { surface } = assetSchema.parse(
        await client.upload(path(id, "assets"), form),
      );
      store(surface);
      return surface;
    },
    removeAsset: async (client, id, name) => {
      const { surface } = oneSchema.parse(
        await client.del(path(id, "assets", name)),
      );
      store(surface);
      return surface;
    },
    call: async (client, id, tool, args) =>
      surfaceCallResultSchema.parse(
        await client.post(path(id, "call"), { tool, args }),
      ),
  };
});

/** Keeps the summaries fresh: on mount, every minute and on focus. */
export function useSurfaceList(): WorkspaceSurfaceSummary[] | null {
  const { client } = useAdmin();
  const list = useSurfaceStore((s) => s.list);
  const refreshList = useSurfaceStore((s) => s.refreshList);
  const hydrateCache = useSurfaceStore((s) => s.hydrateCache);
  useEffect(() => {
    hydrateCache();
    const refresh = () =>
      void refreshList(client).catch((error: unknown) =>
        console.error("Failed to list surfaces:", error),
      );
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [client, refreshList, hydrateCache]);
  return list;
}

/**
 * One surface in full, refetched whenever its summary reports a newer rev —
 * an agent's edit lands with the next list refresh.
 */
export function useSurface(id: string | null): LoadedSurface | null {
  const { client } = useAdmin();
  const loaded = useSurfaceStore((s) => (id ? s.byId[id] : undefined));
  const list = useSurfaceStore((s) => s.list);
  const ensure = useSurfaceStore((s) => s.ensure);
  const listedRev = id
    ? list?.find((summary) => summary.id === id)?.rev
    : undefined;

  // Re-evaluated on every list refresh: a newer listed rev refetches, and so
  // does a surface that failed to load but is still listed.
  useEffect(() => {
    if (!id) return;
    const current = useSurfaceStore.getState().byId[id];
    const force =
      listedRev !== undefined &&
      (current === "missing" ||
        (current !== undefined && current.rev !== listedRev));
    void ensure(client, id, force);
  }, [client, id, ensure, list, listedRev]);

  return loaded ?? null;
}
