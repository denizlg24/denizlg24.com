import { afterEach, describe, expect, test } from "bun:test";
import {
  type Workspace,
  type WorkspaceSave,
  workspaceSaveSchema,
} from "@repo/schemas";
import { createAdminClient } from "../client";
import { seedWorkspace } from "./seed";
import { flushWorkspace, resetWorkspaceSync, useWorkspaceStore } from "./store";

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A server holding one workspace, refusing saves whose base it no longer holds. */
function fakeServer(initial: Workspace | null) {
  let stored = initial;
  const puts: { body: WorkspaceSave }[] = [];
  const client = createAdminClient({
    baseUrl: "/api/admin",
    fetchImpl: async (_input, init) => {
      if (init?.method !== "PUT") return json({ workspace: stored });
      const body = workspaceSaveSchema.parse(JSON.parse(String(init.body)));
      puts.push({ body });
      if ((stored?.savedAt ?? null) !== body.baseSavedAt) {
        return json({ error: "Conflict", workspace: stored }, 409);
      }
      const { baseSavedAt: _, ...workspace } = body;
      stored = workspace;
      return json({ savedAt: workspace.savedAt });
    },
  });
  return {
    client,
    puts,
    stored: () => stored,
    writeElsewhere: (ws: Workspace) => {
      stored = ws;
    },
  };
}

const state = () => useWorkspaceStore.getState();

afterEach(() => {
  resetWorkspaceSync();
  useWorkspaceStore.setState({
    workspace: seedWorkspace(),
    ready: false,
    error: null,
  });
});

describe("workspace sync", () => {
  test("a server-only host adopts the stored copy and saves against it", async () => {
    const remote = { ...seedWorkspace(), savedAt: "2026-10-01T00:00:00.000Z" };
    const server = fakeServer(remote);
    await state().hydrate({ client: server.client });
    expect(state().ready).toBe(true);
    expect(Object.keys(state().workspace.pages)).toEqual(
      Object.keys(remote.pages),
    );

    state().createPage(null, "Reading");
    await flushWorkspace();
    expect(server.puts.at(-1)?.body.baseSavedAt).toBe(remote.savedAt);
    expect(server.stored()?.savedAt).not.toBe(remote.savedAt);
  });

  test("an empty server receives the seed with a null base", async () => {
    const server = fakeServer(null);
    await state().hydrate({ client: server.client });
    await flushWorkspace();
    expect(server.puts[0]?.body.baseSavedAt).toBeNull();
    expect(server.stored()).not.toBeNull();
  });

  test("a save based on a stale copy is refused and the server copy adopted", async () => {
    const remote = { ...seedWorkspace(), savedAt: "2026-10-01T00:00:00.000Z" };
    const server = fakeServer(remote);
    await state().hydrate({ client: server.client });

    const elsewhere = {
      ...seedWorkspace(),
      savedAt: "2026-10-02T00:00:00.000Z",
    };
    server.writeElsewhere(elsewhere);
    const mine = state().createPage(null, "Mine");
    await flushWorkspace();

    expect(server.stored()).toBe(elsewhere);
    expect(state().workspace.pages[mine]).toBeUndefined();
    expect(Object.keys(state().workspace.pages)).toEqual(
      Object.keys(elsewhere.pages),
    );
  });

  test("a newer local copy is pushed over an older server copy", async () => {
    const remote = { ...seedWorkspace(), savedAt: "2026-10-01T00:00:00.000Z" };
    const local = { ...seedWorkspace(), savedAt: "2026-10-03T00:00:00.000Z" };
    const server = fakeServer(remote);
    await state().hydrate({
      client: server.client,
      local: { load: async () => local, save: async () => {} },
    });
    await flushWorkspace();
    expect(server.puts[0]?.body.baseSavedAt).toBe(remote.savedAt);
    expect(Object.keys(server.stored()?.pages ?? {})).toEqual(
      Object.keys(local.pages),
    );
  });
});
