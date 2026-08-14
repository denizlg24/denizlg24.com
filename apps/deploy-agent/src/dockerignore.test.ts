import { describe, expect, it } from "bun:test";

import { compileDockerignore } from "./dockerignore";

describe("compileDockerignore", () => {
  it("takes a directory's contents with it", () => {
    const ignored = compileDockerignore("infra\n");
    expect(ignored.excludes("infra")).toBe(true);
    expect(ignored.excludes("infra/compose/scripts")).toBe(true);
    expect(ignored.excludes("infrastructure/scripts")).toBe(false);
  });

  it("reports an empty file as ignoring nothing", () => {
    const ignored = compileDockerignore("# only a comment\n\n");
    expect(ignored.hasPatterns).toBe(false);
    expect(ignored.excludes("anything")).toBe(false);
  });

  it("lets the last matching pattern win", () => {
    const ignored = compileDockerignore("infra\n!infra/compose/scripts\n");
    expect(ignored.excludes("infra/scripts")).toBe(true);
    expect(ignored.excludes("infra/compose/scripts")).toBe(false);
    // The negation names one path; a sibling under the same excluded parent
    // is still out.
    expect(ignored.excludes("infra/compose/docker-compose.yml")).toBe(true);
  });

  it("keeps a single star inside one segment", () => {
    const ignored = compileDockerignore("infra/systemd/*.env\n");
    expect(ignored.excludes("infra/systemd/api.env")).toBe(true);
    expect(ignored.excludes("infra/systemd/nested/api.env")).toBe(false);
    expect(ignored.excludes("infra/systemd/api.service")).toBe(false);
  });

  it("crosses separators for a double star", () => {
    const ignored = compileDockerignore("**/node_modules\n");
    expect(ignored.excludes("node_modules")).toBe(true);
    expect(ignored.excludes("apps/web/node_modules")).toBe(true);
    expect(
      ignored.excludes("apps/web/node_modules/left-pad/package.json"),
    ).toBe(true);
    expect(ignored.excludes("apps/web/package.json")).toBe(false);
  });

  it("normalises a leading slash and a trailing one", () => {
    const ignored = compileDockerignore("/infra/\n");
    expect(ignored.excludes("infra/scripts")).toBe(true);
  });

  it("matches a dotted pattern literally rather than as a regex", () => {
    const ignored = compileDockerignore(".env.*\n!.env.example\n");
    expect(ignored.excludes(".env.production")).toBe(true);
    expect(ignored.excludes(".env.example")).toBe(false);
    expect(ignored.excludes("aenvbexample")).toBe(false);
  });
});
