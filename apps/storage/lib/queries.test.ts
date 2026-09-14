import { beforeEach, describe, expect, it } from "bun:test";
import { ApiError } from "@repo/cloud-ui/api-error";
import type { StorageFile, StorageFolder } from "@repo/schemas/cloud";
import { QueryClient } from "@tanstack/react-query";

import {
  type ChildrenData,
  type FolderData,
  type FolderPage,
  keys,
} from "./folder-cache";
import {
  createStorageSession,
  type StorageMutationApi,
  type StorageSession,
} from "./queries";

// The optimistic rules of §6.2, one test per row, against a fake API and a
// real QueryClient. Nothing renders: the mutations are cache operations.

const PARENT = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const FOLDER_A = "33333333-3333-4333-8333-333333333333";
const FILE_A = "44444444-4444-4444-8444-444444444444";

function folder(id: string, name: string, parentId = PARENT): StorageFolder {
  return {
    childCount: { files: 0, folders: 0 },
    createdAt: "2026-09-01T00:00:00.000Z",
    id,
    name,
    parentId,
    path: `/root/parent/${name}`,
  };
}

function file(id: string, filename: string): StorageFile {
  return {
    createdAt: "2026-09-02T00:00:00.000Z",
    filename,
    id,
    mimeType: null,
    path: `/root/parent/${filename}`,
    sizeBytes: 10,
    tier: "ssd",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
}

function page(
  id: string,
  path: string,
  subfolders: StorageFolder[],
  files: StorageFile[],
  parentId: string | null = "00000000-0000-4000-8000-000000000000",
): FolderPage {
  return {
    data: {
      ancestors: [],
      files,
      folder: { id, name: "x", parentId, path },
      subfolders,
    },
    pagination: { limit: 100, page: 1, total: files.length, totalPages: 1 },
  };
}

function seed(client: QueryClient, id: string, pageData: FolderPage): void {
  client.setQueryData<FolderData>(keys.folder(id), {
    pageParams: [1],
    pages: [pageData],
  });
  client.setQueryData<ChildrenData>(
    keys.children(id),
    pageData.data.subfolders,
  );
}

function listing(client: QueryClient, id: string) {
  const data = client.getQueryData<FolderData>(keys.folder(id));
  return {
    children: client.getQueryData<ChildrenData>(keys.children(id)) ?? [],
    files: data?.pages.flatMap((p) => p.data.files) ?? [],
    subfolders: data?.pages.flatMap((p) => p.data.subfolders) ?? [],
  };
}

function fakeApi(behaviour: {
  createFolder?: "ok" | "conflict" | "down";
  update?: "ok" | "down";
  delete?: "ok" | "down";
}): StorageMutationApi & { calls: string[] } {
  const calls: string[] = [];
  const down = () => new ApiError("NETWORK", "API unreachable", 0);
  return {
    calls,
    async createFolder(input) {
      calls.push(`createFolder:${input.name}`);
      if (behaviour.createFolder === "conflict") {
        throw new ApiError("FOLDER_EXISTS", "exists", 409);
      }
      if (behaviour.createFolder === "down") throw down();
      return {
        id: FOLDER_A,
        name: input.name,
        parentId: input.parentId,
        path: `/root/parent/${input.name}`,
      };
    },
    async updateFolder(id, input) {
      calls.push(`updateFolder:${id}:${JSON.stringify(input)}`);
      if (behaviour.update === "down") throw down();
      return {
        id,
        name: input.name ?? "moved",
        parentId: input.parentId ?? PARENT,
        path: `/root/${input.parentId === TARGET ? "target" : "parent"}/${input.name ?? "moved"}`,
      };
    },
    async updateFile(id, input) {
      calls.push(`updateFile:${id}:${JSON.stringify(input)}`);
      if (behaviour.update === "down") throw down();
      return {
        filename: input.filename ?? "a.txt",
        folderId: input.folderId ?? PARENT,
        id,
        path: `/root/${input.folderId === TARGET ? "target" : "parent"}/${input.filename ?? "a.txt"}`,
      };
    },
    async deleteFile(id) {
      calls.push(`deleteFile:${id}`);
      if (behaviour.delete === "down") throw down();
      return { id };
    },
    async deleteFolder(id) {
      calls.push(`deleteFolder:${id}`);
      if (behaviour.delete === "down") throw down();
      return { deletedFiles: 0, deletedFolders: 1, id };
    },
  };
}

function session(api: StorageMutationApi): StorageSession {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createStorageSession(client, api);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("create folder", () => {
  let api: ReturnType<typeof fakeApi>;
  let s: StorageSession;
  beforeEach(() => {
    api = fakeApi({});
    s = session(api);
    seed(
      s.client,
      PARENT,
      page(PARENT, "/root/parent", [folder("f0", "zed")], []),
    );
  });

  it("inserts a pending placeholder, then the server row, and navigates only after", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = api.createFolder;
    api.createFolder = async (input) => {
      await gate;
      return create(input);
    };
    const promise = s.mutations.createFolder(PARENT, "alpha");
    // The placeholder lands after the same-name delete check, one tick in.
    await tick();
    const during = listing(s.client, PARENT);
    release();
    expect(
      during.subfolders.some(
        (row) => row.name === "alpha" && row.pending === true,
      ),
    ).toBe(true);
    expect(during.children.some((row) => row.name === "alpha")).toBe(true);
    const created = await promise;
    expect(created.id).toBe(FOLDER_A);
    const after = listing(s.client, PARENT);
    expect(after.subfolders.map((row) => row.name)).toEqual(["alpha", "zed"]);
    expect(after.subfolders[0]?.pending).toBeUndefined();
    expect(after.subfolders[0]?.id).toBe(FOLDER_A);
    expect(s.recentCreates.has(FOLDER_A)).toBe(true);
  });

  it("removes the placeholder and rethrows when the server refuses", async () => {
    api = fakeApi({ createFolder: "conflict" });
    s = session(api);
    seed(
      s.client,
      PARENT,
      page(PARENT, "/root/parent", [folder("f0", "zed")], []),
    );
    await expect(
      s.mutations.createFolder(PARENT, "zed"),
    ).rejects.toBeInstanceOf(ApiError);
    expect(listing(s.client, PARENT).subfolders.map((row) => row.id)).toEqual([
      "f0",
    ]);
  });

  it("commits a pending delete of the same name before creating", async () => {
    const { undo } = s.mutations.scheduleDelete(
      [{ id: "f0", name: "zed", type: "folder" }],
      PARENT,
    );
    expect(s.deletes.isDeleting("f0")).toBe(true);
    await s.mutations.createFolder(PARENT, "zed");
    expect(api.calls[0]).toBe("deleteFolder:f0");
    expect(api.calls[1]).toBe("createFolder:zed");
    expect(s.deletes.isDeleting("f0")).toBe(false);
    undo();
  });
});

describe("rename", () => {
  it("patches the folder name in place and restores it on failure", async () => {
    const api = fakeApi({ update: "down" });
    const s = session(api);
    seed(
      s.client,
      PARENT,
      page(PARENT, "/root/parent", [folder(FOLDER_A, "old")], []),
    );
    const promise = s.mutations.renameFolder(FOLDER_A, PARENT, "new");
    expect(listing(s.client, PARENT).subfolders[0]?.name).toBe("new");
    expect(listing(s.client, PARENT).children[0]?.name).toBe("new");
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    expect(listing(s.client, PARENT).subfolders[0]?.name).toBe("old");
    expect(listing(s.client, PARENT).children[0]?.name).toBe("old");
  });

  it("drops cached listings beneath a renamed folder", async () => {
    const api = fakeApi({});
    const s = session(api);
    seed(
      s.client,
      PARENT,
      page(PARENT, "/root/parent", [folder(FOLDER_A, "old")], []),
    );
    seed(
      s.client,
      FOLDER_A,
      page(FOLDER_A, "/root/parent/old", [], [], PARENT),
    );
    seed(
      s.client,
      "deep",
      page("deep", "/root/parent/old/deep", [], [], FOLDER_A),
    );
    seed(
      s.client,
      "other",
      page("other", "/root/parent/older", [], [], PARENT),
    );
    await s.mutations.renameFolder(FOLDER_A, PARENT, "new");
    expect(s.client.getQueryData(keys.folder(FOLDER_A))).toBeUndefined();
    expect(s.client.getQueryData(keys.folder("deep"))).toBeUndefined();
    // A sibling whose path merely shares the prefix as text is untouched.
    expect(s.client.getQueryData(keys.folder("other"))).toBeDefined();
    expect(listing(s.client, PARENT).subfolders[0]?.path).toBe(
      "/root/parent/new",
    );
  });

  it("patches a filename and takes the server's path", async () => {
    const api = fakeApi({});
    const s = session(api);
    seed(
      s.client,
      PARENT,
      page(PARENT, "/root/parent", [], [file(FILE_A, "a.txt")]),
    );
    await s.mutations.renameFile(FILE_A, PARENT, "b.txt");
    expect(listing(s.client, PARENT).files[0]?.filename).toBe("b.txt");
    expect(listing(s.client, PARENT).files[0]?.path).toBe("/root/parent/b.txt");
  });
});

describe("move", () => {
  function seedBoth(s: StorageSession) {
    seed(
      s.client,
      PARENT,
      page(
        PARENT,
        "/root/parent",
        [folder(FOLDER_A, "sub")],
        [file(FILE_A, "a.txt")],
      ),
    );
    seed(s.client, TARGET, page(TARGET, "/root/target", [], []));
  }

  it("removes from the source and lands pending rows in the target at once", async () => {
    const api = fakeApi({});
    const s = session(api);
    seedBoth(s);
    const promise = s.mutations.move(
      [
        { id: FOLDER_A, name: "sub", type: "folder" },
        { id: FILE_A, name: "a.txt", type: "file" },
      ],
      PARENT,
      TARGET,
    );
    const source = listing(s.client, PARENT);
    expect(source.subfolders).toHaveLength(0);
    expect(source.files).toHaveLength(0);
    expect(source.children).toHaveLength(0);
    const target = listing(s.client, TARGET);
    expect(target.subfolders[0]).toMatchObject({
      id: FOLDER_A,
      path: "/root/target/sub",
      pending: true,
    });
    expect(target.files[0]).toMatchObject({ id: FILE_A, pending: true });
    const outcome = await promise;
    expect(outcome).toEqual({ failures: [], moved: 2 });
    // Both requests were issued before either answered.
    expect(api.calls).toHaveLength(2);
  });

  it("puts back only what failed to land", async () => {
    const api = fakeApi({});
    const s = session(api);
    seedBoth(s);
    api.updateFile = async () => {
      throw new ApiError("FILE_EXISTS", "taken", 409);
    };
    const outcome = await s.mutations.move(
      [
        { id: FOLDER_A, name: "sub", type: "folder" },
        { id: FILE_A, name: "a.txt", type: "file" },
      ],
      PARENT,
      TARGET,
    );
    expect(outcome.moved).toBe(1);
    expect(outcome.failures).toEqual([{ message: "taken", name: "a.txt" }]);
    expect(listing(s.client, PARENT).files.map((row) => row.id)).toEqual([
      FILE_A,
    ]);
    expect(listing(s.client, PARENT).subfolders).toHaveLength(0);
    expect(listing(s.client, TARGET).files).toHaveLength(0);
    expect(listing(s.client, TARGET).subfolders.map((row) => row.id)).toEqual([
      FOLDER_A,
    ]);
  });
});

describe("deferred delete", () => {
  it("marks rows rather than hiding them, sends after the window, and drops them", async () => {
    const api = fakeApi({});
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const s = createStorageSession(client, api);
    // A short window so the test does not wait ten seconds.
    const { PendingDeletes } = await import("./pending-deletes");
    const deletes = new PendingDeletes(client, api, 20);
    seed(
      client,
      PARENT,
      page(
        PARENT,
        "/root/parent",
        [folder(FOLDER_A, "sub")],
        [file(FILE_A, "a.txt")],
      ),
    );
    let settled: unknown = null;
    deletes.schedule(
      [
        { id: FOLDER_A, name: "sub", type: "folder" },
        { id: FILE_A, name: "a.txt", type: "file" },
      ],
      PARENT,
      (failures) => {
        settled = failures;
      },
    );
    expect(deletes.isDeleting(FOLDER_A)).toBe(true);
    expect(deletes.deleteAt(FILE_A)).toBeGreaterThan(Date.now());
    // Still in the listing: the view dims it, nothing hides it.
    expect(listing(client, PARENT).files).toHaveLength(1);
    expect(api.calls).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await tick();
    expect(api.calls.sort()).toEqual([
      `deleteFile:${FILE_A}`,
      `deleteFolder:${FOLDER_A}`,
    ]);
    expect(listing(client, PARENT).files).toHaveLength(0);
    expect(listing(client, PARENT).subfolders).toHaveLength(0);
    expect(listing(client, PARENT).children).toHaveLength(0);
    expect(deletes.isDeleting(FOLDER_A)).toBe(false);
    expect(settled).toEqual([]);
    s.deletes.flush();
  });

  it("undo inside the window sends nothing", async () => {
    const api = fakeApi({});
    const client = new QueryClient();
    const { PendingDeletes } = await import("./pending-deletes");
    const deletes = new PendingDeletes(client, api, 20);
    seed(
      client,
      PARENT,
      page(PARENT, "/root/parent", [], [file(FILE_A, "a.txt")]),
    );
    const { undo } = deletes.schedule(
      [{ id: FILE_A, name: "a.txt", type: "file" }],
      PARENT,
    );
    undo();
    expect(deletes.isDeleting(FILE_A)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(api.calls).toHaveLength(0);
    expect(listing(client, PARENT).files).toHaveLength(1);
  });

  it("a failed delete keeps the row and reports the name", async () => {
    const api = fakeApi({ delete: "down" });
    const client = new QueryClient();
    const { PendingDeletes } = await import("./pending-deletes");
    const deletes = new PendingDeletes(client, api, 10);
    seed(
      client,
      PARENT,
      page(PARENT, "/root/parent", [], [file(FILE_A, "a.txt")]),
    );
    let failures: { name: string }[] = [];
    deletes.schedule(
      [{ id: FILE_A, name: "a.txt", type: "file" }],
      PARENT,
      (result) => {
        failures = result;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    await tick();
    expect(failures.map((f) => f.name)).toEqual(["a.txt"]);
    expect(listing(client, PARENT).files).toHaveLength(1);
    expect(deletes.isDeleting(FILE_A)).toBe(false);
  });
});

describe("upload finalize", () => {
  it("invalidates the target folder and recent", async () => {
    const api = fakeApi({});
    const s = session(api);
    seed(s.client, PARENT, page(PARENT, "/root/parent", [], []));
    s.client.setQueryData(keys.recent, []);
    s.mutations.uploaded(PARENT);
    await tick();
    expect(s.client.getQueryState(keys.folder(PARENT))?.isInvalidated).toBe(
      true,
    );
    expect(s.client.getQueryState(keys.recent)?.isInvalidated).toBe(true);
  });
});
