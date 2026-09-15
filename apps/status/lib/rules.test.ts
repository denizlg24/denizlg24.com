import { describe, expect, test } from "bun:test";
import {
  AUTO_RESOLVE_MINUTES,
  confirmStatus,
  maintenanceCovers,
  maintenanceOccurrence,
} from "./health";
import { newAutoIncident, planIncidents } from "./incidents";
import type { Health, Incident, Service } from "./model";

const service = (id: string, status: Health, name = id): Service => ({
  id,
  name,
  group: "Infrastructure",
  description: "",
  status,
  observed: status,
  since: null,
  checkedAt: "2026-09-15T08:00:00.000Z",
  latencyMs: null,
  evidence:
    status === "operational"
      ? []
      : [
          {
            source: "Application runtime",
            status,
            at: "2026-09-15T08:00:00.000Z",
            latencyMs: null,
            detail: "Timeout",
          },
        ],
});

describe("confirmed status", () => {
  test("one failed observation degrades; three in a row confirm an outage", () => {
    expect(confirmStatus("down", "operational", [])).toBe("degraded");
    expect(confirmStatus("down", "degraded", ["down"])).toBe("degraded");
    expect(confirmStatus("down", "degraded", ["down", "down"])).toBe("down");
  });
  test("a confirmed outage does not lift on the first clean observation", () => {
    expect(confirmStatus("operational", "down", ["down", "down"])).toBe("down");
    expect(confirmStatus("operational", "down", ["operational", "down"])).toBe(
      "operational",
    );
    expect(confirmStatus("operational", "degraded", ["down"])).toBe("degraded");
  });
  test("a stale collector holds the last confirmed status rather than clearing or breaking it", () => {
    expect(confirmStatus("unknown", "down", ["down"])).toBe("down");
    expect(confirmStatus("unknown", "operational", [])).toBe("operational");
    expect(
      confirmStatus("unknown", "operational", new Array(10).fill("unknown")),
    ).toBe("unknown");
    expect(confirmStatus("unknown", "unknown", [])).toBe("unknown");
  });
  test("a flapping probe never reaches down", () => {
    let previous: Health = "operational";
    const seen: Health[] = [];
    for (const observed of [
      "down",
      "operational",
      "down",
      "operational",
      "down",
    ] as const) {
      previous = confirmStatus(observed, previous, seen);
      seen.unshift(observed);
      expect(previous).not.toBe("down");
    }
  });
});

describe("maintenance windows", () => {
  const window = {
    startsAt: "2026-09-13T01:55:00.000Z",
    endsAt: "2026-09-13T02:20:00.000Z",
  };
  test("a one-off window covers only its own dates", () => {
    expect(maintenanceCovers(window, Date.parse("2026-09-13T02:00:00Z"))).toBe(
      true,
    );
    expect(maintenanceCovers(window, Date.parse("2026-09-20T02:00:00Z"))).toBe(
      false,
    );
  });
  test("a weekly window recurs at the same weekday and time, never before it begins", () => {
    const weekly = { ...window, repeat: "weekly" as const };
    expect(maintenanceCovers(weekly, Date.parse("2026-09-20T02:00:00Z"))).toBe(
      true,
    );
    expect(maintenanceCovers(weekly, Date.parse("2026-09-20T02:21:00Z"))).toBe(
      false,
    );
    expect(maintenanceCovers(weekly, Date.parse("2026-09-06T02:00:00Z"))).toBe(
      false,
    );
    expect(
      maintenanceOccurrence(weekly, Date.parse("2026-09-17T12:00:00Z")),
    ).toEqual({
      startsAt: "2026-09-20T01:55:00.000Z",
      endsAt: "2026-09-20T02:20:00.000Z",
    });
    expect(
      maintenanceOccurrence(weekly, Date.parse("2026-09-20T02:00:00Z"))
        .startsAt,
    ).toBe("2026-09-20T01:55:00.000Z");
  });
});

describe("incident derivation", () => {
  const now = Date.parse("2026-09-15T08:00:00Z");
  test("only a confirmed outage opens an incident, and related services share one", () => {
    const plan = planIncidents({
      services: [
        service("postgres", "down"),
        service("api", "down"),
        service("cloud", "degraded"),
        service("web", "down"),
      ],
      open: [],
      now,
    });
    expect(plan.open.map((group) => group.services.map((s) => s.id))).toEqual([
      ["postgres", "api"],
      ["web"],
    ]);
    expect(plan.merge).toEqual([]);
  });
  test("a service already named by any open incident never opens another", () => {
    const manual: Incident = {
      ...newAutoIncident([service("web", "down")], "2026-09-15T07:00:00Z"),
      _id: "manual:1",
    };
    const plan = planIncidents({
      services: [service("web", "down")],
      open: [manual],
      now,
    });
    expect(plan.open).toEqual([]);
    expect(plan.merge).toEqual([]);
  });
  test("a dependent failing later joins the open automatic incident", () => {
    const incident = newAutoIncident(
      [service("api", "down")],
      "2026-09-15T07:50:00Z",
    );
    const plan = planIncidents({
      services: [service("api", "down"), service("forge", "down")],
      open: [incident],
      now,
    });
    expect(plan.open).toEqual([]);
    expect(plan.merge.map((entry) => entry.service.id)).toEqual(["forge"]);
  });
  test("recovery is noted, held, and resolved only after the quiet period", () => {
    const incident = newAutoIncident(
      [service("api", "down")],
      "2026-09-15T07:50:00Z",
    );
    const recovered = planIncidents({
      services: [service("api", "operational")],
      open: [incident],
      now,
    });
    expect(recovered.recover).toEqual([incident._id]);
    expect(recovered.resolve).toEqual([]);
    const holding: Incident = {
      ...incident,
      recoveredAt: new Date(now - 60_000).toISOString(),
    };
    expect(
      planIncidents({
        services: [service("api", "operational")],
        open: [holding],
        now,
      }).resolve,
    ).toEqual([]);
    const settled: Incident = {
      ...incident,
      recoveredAt: new Date(now - AUTO_RESOLVE_MINUTES * 60_000).toISOString(),
    };
    expect(
      planIncidents({
        services: [service("api", "operational")],
        open: [settled],
        now,
      }).resolve,
    ).toEqual([incident._id]);
    const regressed = planIncidents({
      services: [service("api", "degraded")],
      open: [holding],
      now,
    });
    expect(regressed.regress.map((entry) => entry.incidentId)).toEqual([
      incident._id,
    ]);
    expect(regressed.resolve).toEqual([]);
  });
  test("a manual incident is never recovered or resolved by monitoring", () => {
    const manual: Incident = {
      ...newAutoIncident([service("api", "down")], "2026-09-15T07:00:00Z"),
      _id: "manual:1",
      recoveredAt: new Date(now - 60 * 60_000).toISOString(),
    };
    const plan = planIncidents({
      services: [service("api", "operational")],
      open: [manual],
      now,
    });
    expect(plan.recover).toEqual([]);
    expect(plan.resolve).toEqual([]);
  });
  test("a new automatic incident carries the failing evidence and a private first update", () => {
    const incident = newAutoIncident(
      [service("api", "down", "Cloud API")],
      "2026-09-15T08:00:00Z",
    );
    expect(incident._id).toMatch(/^auto:/);
    expect(incident.title).toBe("Cloud API interruption");
    expect(incident.evidence).toHaveLength(1);
    expect(incident.updates[0]?.visibility).toBe("private");
    expect(incident.cause).toContain("Timeout");
  });
});
