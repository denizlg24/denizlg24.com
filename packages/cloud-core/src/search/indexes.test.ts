import { describe, expect, it, mock } from "bun:test";

import {
  createProjectIndex,
  deleteAllProjectIndexes,
  deleteProjectIndex,
  getProjectIndexes,
  parseScopedIndexName,
  scopedIndexName,
} from "./indexes";

function waitableTask() {
  return {
    waitTask: mock(async () => undefined),
  };
}

describe("project search indexes", () => {
  it("preserves scoped index naming and first-separator parsing", () => {
    expect(scopedIndexName("my-app", "user_profiles")).toBe(
      "my-app_user_profiles",
    );
    expect(parseScopedIndexName("my-app_user_profiles")).toEqual({
      project: "my-app",
      collection: "user_profiles",
    });
    expect(parseScopedIndexName("unscoped")).toBeNull();
  });

  it("filters by the project prefix", async () => {
    const indexes = await getProjectIndexes(
      {
        getIndexes: mock(async () => ({
          results: [
            { uid: "project_users" },
            { uid: "project_posts" },
            { uid: "projectile_noise" },
          ],
        })),
      },
      "project",
    );

    expect(indexes.map((index) => index.uid)).toEqual([
      "project_users",
      "project_posts",
    ]);
  });

  it("creates and deletes scoped indexes while waiting for tasks", async () => {
    const createTask = waitableTask();
    const deleteTask = waitableTask();
    const created: Array<{
      uid: string;
      options: { primaryKey: string };
    }> = [];
    const deleted: string[] = [];

    await createProjectIndex(
      {
        createIndex(uid, options) {
          created.push({ uid, options });
          return createTask;
        },
      },
      "project",
      "users",
    );
    await deleteProjectIndex(
      {
        deleteIndex(uid) {
          deleted.push(uid);
          return deleteTask;
        },
      },
      "project",
      "users",
    );

    expect(created).toEqual([
      { uid: "project_users", options: { primaryKey: "id" } },
    ]);
    expect(deleted).toEqual(["project_users"]);
    expect(createTask.waitTask).toHaveBeenCalledTimes(1);
    expect(deleteTask.waitTask).toHaveBeenCalledTimes(1);
  });

  it("deletes every matching index", async () => {
    const deleted: string[] = [];
    await deleteAllProjectIndexes(
      {
        getIndexes: async () => ({
          results: [
            { uid: "project_users" },
            { uid: "other_users" },
            { uid: "project_posts" },
          ],
        }),
        deleteIndex(uid) {
          deleted.push(uid);
          return waitableTask();
        },
      },
      "project",
    );

    expect(deleted).toEqual(["project_users", "project_posts"]);
  });
});
