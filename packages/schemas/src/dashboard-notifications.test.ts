import { describe, expect, test } from "bun:test";
import {
  DASHBOARD_NOTIFICATION_KINDS,
  DASHBOARD_NOTIFICATIONS,
  mobileNotifyInputSchema,
  notificationEnabled,
  resolveMobileNotify,
} from "./dashboard-notifications";

describe("dashboard notifications", () => {
  test("every kind has a spec", () => {
    for (const kind of DASHBOARD_NOTIFICATION_KINDS) {
      expect(DASHBOARD_NOTIFICATIONS[kind].label.length).toBeGreaterThan(0);
    }
  });

  test("a missing toggle means the kind's default", () => {
    expect(notificationEnabled(undefined, "task_finished")).toBe(false);
    expect(notificationEnabled({}, "order_filled")).toBe(true);
    expect(notificationEnabled({ order_filled: false }, "order_filled")).toBe(
      false,
    );
  });

  test("cloud types map onto kinds, noise maps to nothing", () => {
    expect(resolveMobileNotify({ cloudType: "container_oom" })).toEqual({
      kind: "container_unhealthy",
    });
    expect(resolveMobileNotify({ cloudType: "metric_rule_resolved" })).toEqual({
      kind: "metric_alert",
      level: "passive",
    });
    expect(resolveMobileNotify({ cloudType: "backup_completed" })).toBeNull();
    expect(resolveMobileNotify({ kind: "incident", level: "passive" })).toEqual(
      {
        kind: "incident",
        level: "passive",
      },
    );
  });

  test("a request names a kind or a cloud type, and links stay in the app", () => {
    expect(
      mobileNotifyInputSchema.safeParse({ title: "x", dedupeKey: "k" }).success,
    ).toBe(false);
    expect(
      mobileNotifyInputSchema.safeParse({
        kind: "incident",
        title: "x",
        dedupeKey: "k",
        url: "https://evil.example",
      }).success,
    ).toBe(false);
  });
});
