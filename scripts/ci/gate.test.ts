import { describe, expect, it } from "bun:test";
import { selectTargets } from "./gate";
import { gates } from "./gates";

const ids = (gate: string, changed: string[], affected: string[] | null) =>
  selectTargets(
    gate,
    gates[gate] ?? [],
    changed,
    affected === null ? null : new Set(affected),
  ).targets.map((target) => target.id);

describe("selectTargets", () => {
  it("ignores documentation anywhere in an app", () => {
    expect(
      ids("personal-ios", ["apps/hours-mobile/AGENTS.md", "CLAUDE.md"], []),
    ).toEqual([]);
  });

  it("selects only the app whose directory changed", () => {
    expect(
      ids("personal-ios", ["apps/voice-mobile/app/index.tsx"], []),
    ).toEqual(["voice"]);
  });

  it("selects the apps that share a changed package", () => {
    expect(
      ids("personal-ios", ["packages/native-ui/src/button.tsx"], []),
    ).toEqual(["hours", "voice", "location", "dashboard"]);
  });

  it("does not rebuild for an unrelated lockfile change", () => {
    expect(ids("personal-ios", ["bun.lock"], ["stockwatcher"])).toEqual([]);
    expect(ids("macros-mobile", ["bun.lock"], ["stockwatcher"])).toEqual([]);
  });

  it("rebuilds only the apps turbo reports for a lockfile change", () => {
    expect(
      ids("personal-ios", ["bun.lock"], ["stockwatcher", "hours-mobile"]),
    ).toEqual(["hours"]);
  });

  it("falls back to everything when the lockfile cannot be analysed", () => {
    expect(ids("personal-ios", ["bun.lock"], null)).toHaveLength(5);
  });

  it("treats a root manifest or its own workflow as touching everything", () => {
    expect(ids("macros-mobile", ["package.json"], [])).toEqual([
      "macros-mobile",
    ]);
    expect(ids("stream", [".github/workflows/stream.yml"], [])).toEqual([
      "stream",
    ]);
  });

  it("selects nothing for a stockwatcher-only change", () => {
    const changed = ["apps/stockwatcher/lib/routines.ts", "bun.lock"];
    for (const gate of Object.keys(gates)) {
      expect(ids(gate, changed, ["stockwatcher"])).toEqual([]);
    }
  });
});
