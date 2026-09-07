import { expect, test } from "bun:test";
import {
  type AdminChange,
  optimisticOrder,
  pendingMessage,
} from "./admin-feedback";

test("optimistic moves compose in order without changing the server snapshot", () => {
  const ids = ["api", "forge", "storage"];
  const changes: AdminChange[] = [
    {
      operation: "config-service-move",
      id: "storage",
      fields: { direction: "up" },
    },
    {
      operation: "config-service-move",
      id: "api",
      fields: { direction: "down" },
    },
  ];
  expect(optimisticOrder(ids, changes)).toEqual(["storage", "api", "forge"]);
  expect(ids).toEqual(["api", "forge", "storage"]);
  expect(optimisticOrder(ids, [])).toEqual(ids);
});

test("host operations describe dispatch rather than claiming completion", () => {
  expect(
    pendingMessage({
      operation: "dr-command",
      id: "forge",
      fields: { action: "run" },
    }),
  ).toBe("Queueing backup…");
  expect(
    pendingMessage({
      operation: "dr-command",
      id: "forge",
      fields: { action: "schedule" },
    }),
  ).toBe("Queueing schedule change…");
});
