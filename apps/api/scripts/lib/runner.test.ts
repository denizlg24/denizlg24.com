import { describe, expect, test } from "bun:test";

import {
  MARKER_IDENTIFIER,
  MARKER_SEQUENCE,
  MARKERS,
  markerIdentifier,
  parseFlags,
  ScriptError,
} from "./runner";

describe("parseFlags", () => {
  test("defaults to a dry run when no mode flag is given", () => {
    expect(parseFlags([]).dryRun).toBe(true);
  });

  test("only --execute turns off the dry run", () => {
    expect(parseFlags(["--execute"]).dryRun).toBe(false);
    expect(parseFlags(["--dry-run"]).dryRun).toBe(true);
  });

  test("rejects both mode flags rather than picking a precedence", () => {
    expect(() => parseFlags(["--dry-run", "--execute"])).toThrow(ScriptError);
  });

  test("an unrelated flag never implies --execute", () => {
    expect(parseFlags(["--json", "--live"]).dryRun).toBe(true);
  });

  test("reads flag values", () => {
    const flags = parseFlags([
      "--report",
      "/tmp/report.md",
      "--log",
      "/tmp/run.jsonl",
    ]);
    expect(flags.reportPath).toBe("/tmp/report.md");
    expect(flags.logPath).toBe("/tmp/run.jsonl");
  });

  test("a value-taking flag followed by another flag is an error", () => {
    expect(() => parseFlags(["--report", "--execute"])).toThrow(ScriptError);
    expect(() => parseFlags(["--log"])).toThrow(ScriptError);
  });

  test("--live and --json are parsed independently", () => {
    const flags = parseFlags(["--live", "--json"]);
    expect(flags.live).toBe(true);
    expect(flags.json).toBe(true);
  });
});

describe("marker sequence", () => {
  test("schema is applied before users, and users before the S3 preflight", () => {
    expect(MARKER_SEQUENCE.indexOf(MARKERS.schema)).toBeLessThan(
      MARKER_SEQUENCE.indexOf(MARKERS.users),
    );
    expect(MARKER_SEQUENCE.indexOf(MARKERS.users)).toBeLessThan(
      MARKER_SEQUENCE.indexOf(MARKERS.s3Legacy),
    );
  });

  test("every marker id is unique", () => {
    expect(new Set(MARKER_SEQUENCE).size).toBe(MARKER_SEQUENCE.length);
  });

  test("the users marker matches the id plan 003 already writes", () => {
    expect(MARKERS.users).toBe("cloud-migration:003-users");
  });

  test("the users marker resolves under plan 003's identifier, not 012's", () => {
    // migrate-users.ts writes identifier "cloud-migration:003"; reading it
    // under 012's identifier would silently never match.
    expect(markerIdentifier(MARKERS.users)).toBe("cloud-migration:003");
    expect(markerIdentifier(MARKERS.schema)).toBe(MARKER_IDENTIFIER);
    expect(markerIdentifier(MARKERS.s3Legacy)).toBe(MARKER_IDENTIFIER);
  });
});
