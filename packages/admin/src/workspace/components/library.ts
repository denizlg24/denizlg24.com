"use client";

import {
  type ComponentInput,
  type ComponentPatch,
  type WorkspaceComponent,
  type WorkspaceComponentSummary,
  workspaceComponentSchema,
  workspaceComponentSummarySchema,
} from "@repo/schemas";
import { useEffect } from "react";
import { z } from "zod";
import { create } from "zustand";
import type { AdminClient } from "../../client";
import { useAdmin } from "../../provider";

const ROOT = "workspace/components";
const listSchema = z.object({
  components: z.array(workspaceComponentSummarySchema),
});
const oneSchema = z.object({ component: workspaceComponentSchema });

type Loaded = WorkspaceComponent | "missing";

interface ComponentLibraryState {
  list: WorkspaceComponentSummary[] | null;
  byId: Record<string, Loaded>;
  refreshList: (client: AdminClient) => Promise<void>;
  ensure: (client: AdminClient, id: string, force?: boolean) => Promise<void>;
  create: (
    client: AdminClient,
    input: ComponentInput,
  ) => Promise<WorkspaceComponent>;
  update: (
    client: AdminClient,
    id: string,
    patch: ComponentPatch,
  ) => Promise<WorkspaceComponent>;
  remove: (client: AdminClient, id: string) => Promise<void>;
}

const inflight = new Set<string>();

export const useComponentLibrary = create<ComponentLibraryState>((set, get) => {
  const store = (component: WorkspaceComponent) => {
    set({ byId: { ...get().byId, [component.id]: component } });
  };
  return {
    list: null,
    byId: {},
    refreshList: async (client) => {
      const { components } = listSchema.parse(await client.get(ROOT));
      set({ list: components });
    },
    ensure: async (client, id, force = false) => {
      if (!id || inflight.has(id) || (!force && get().byId[id])) return;
      inflight.add(id);
      try {
        const { component } = oneSchema.parse(
          await client.get(`${ROOT}/${encodeURIComponent(id)}`),
        );
        store(component);
      } catch {
        set({ byId: { ...get().byId, [id]: "missing" } });
      } finally {
        inflight.delete(id);
      }
    },
    create: async (client, input) => {
      const { component } = oneSchema.parse(await client.post(ROOT, input));
      store(component);
      await get().refreshList(client);
      return component;
    },
    update: async (client, id, patch) => {
      const { component } = oneSchema.parse(
        await client.patch(`${ROOT}/${encodeURIComponent(id)}`, patch),
      );
      store(component);
      await get().refreshList(client);
      return component;
    },
    remove: async (client, id) => {
      await client.del(`${ROOT}/${encodeURIComponent(id)}`);
      const { [id]: _gone, ...rest } = get().byId;
      set({ byId: rest });
      await get().refreshList(client);
    },
  };
});

/** One component, fetched once per session and refreshed when the window regains focus. */
export function useComponent(id: string): Loaded | null {
  const { client } = useAdmin();
  const loaded = useComponentLibrary((s) => (id ? s.byId[id] : undefined));
  const ensure = useComponentLibrary((s) => s.ensure);
  useEffect(() => {
    if (!id) return;
    void ensure(client, id);
    const onFocus = () => void ensure(client, id, true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [client, id, ensure]);
  return loaded ?? null;
}

export function useComponentList(): WorkspaceComponentSummary[] | null {
  const { client } = useAdmin();
  const list = useComponentLibrary((s) => s.list);
  const refreshList = useComponentLibrary((s) => s.refreshList);
  useEffect(() => {
    void refreshList(client).catch((error: unknown) =>
      console.error("Failed to list components:", error),
    );
  }, [client, refreshList]);
  return list;
}
