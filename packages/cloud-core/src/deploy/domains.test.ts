import { describe, expect, it } from "bun:test";

import { defaultDomainMode, isZoneHostname, planRouting } from "./domains";

const ZONE = "denizlg24.com";

describe("isZoneHostname", () => {
  it("counts the apex as inside the zone", () => {
    // Three behaviours hang off this: the default mode, whether the
    // managed-record conflict check runs, and whether deletion reaps the
    // record. Reading the apex as foreign gets all three wrong at once.
    expect(isZoneHostname(ZONE, ZONE)).toBe(true);
    expect(isZoneHostname(ZONE.toUpperCase(), ZONE)).toBe(true);
  });

  it("counts a subdomain, at any depth", () => {
    expect(isZoneHostname(`app.${ZONE}`, ZONE)).toBe(true);
    expect(isZoneHostname(`a.b.${ZONE}`, ZONE)).toBe(true);
  });

  it("does not count a name that merely ends in the same letters", () => {
    expect(isZoneHostname(`notdenizlg24.com`, ZONE)).toBe(false);
    expect(isZoneHostname("denizlg24.com.evil.test", ZONE)).toBe(false);
    expect(isZoneHostname("example.com", ZONE)).toBe(false);
  });
});

describe("defaultDomainMode", () => {
  it("routes the apex through a plain record, not Cloudflare for SaaS", () => {
    expect(defaultDomainMode(ZONE, ZONE)).toBe("zone_record");
  });

  it("routes a subdomain through a plain record", () => {
    expect(defaultDomainMode(`app.${ZONE}`, ZONE)).toBe("zone_record");
  });

  it("routes a foreign name through a custom hostname", () => {
    expect(defaultDomainMode("shop.example.com", ZONE)).toBe("custom_hostname");
  });
});

describe("planRouting", () => {
  const preview = { hostname: "pr-4.denizlg24.com", kind: "preview" } as const;
  const production = {
    hostname: "app.denizlg24.com",
    kind: "production",
  } as const;

  it("serves every stable domain unless a redirect is explicit", () => {
    const routing = planRouting(production, [
      { hostname: "a.denizlg24.com", redirectTo: null },
      { hostname: "b.denizlg24.com", redirectTo: null },
    ]);

    expect(routing.serve).toEqual([
      "app.denizlg24.com",
      "a.denizlg24.com",
      "b.denizlg24.com",
    ]);
    expect(routing.redirects).toEqual([]);
  });

  it("redirects only the domain with an explicit destination", () => {
    const routing = planRouting(production, [
      { hostname: "www.denizlg24.com", redirectTo: "denizlg24.com" },
      { hostname: "denizlg24.com", redirectTo: null },
    ]);

    expect(routing.serve).toEqual(["app.denizlg24.com", "denizlg24.com"]);
    expect(routing.redirects).toEqual([
      { hostname: "www.denizlg24.com", to: "denizlg24.com" },
    ]);
  });

  it("supports independent redirect destinations", () => {
    const routing = planRouting(production, [
      { hostname: "www.denizlg24.com", redirectTo: "denizlg24.com" },
      { hostname: "old.denizlg24.com", redirectTo: "docs.denizlg24.com" },
      { hostname: "denizlg24.com", redirectTo: null },
      { hostname: "docs.denizlg24.com", redirectTo: null },
    ]);

    expect(routing.redirects).toEqual([
      { hostname: "www.denizlg24.com", to: "denizlg24.com" },
      { hostname: "old.denizlg24.com", to: "docs.denizlg24.com" },
    ]);
  });

  it("always serves the deployment's own hostname", () => {
    // It is the only name that exists before any domain is attached, and it is
    // what the build log links to — redirecting it would break the one URL
    // that is guaranteed to work.
    const routing = planRouting(production, [
      { hostname: "app.denizlg24.com", redirectTo: "denizlg24.com" },
      { hostname: "denizlg24.com", redirectTo: null },
    ]);

    expect(routing.serve).toContain("app.denizlg24.com");
    expect(routing.redirects).not.toContainEqual({
      hostname: "app.denizlg24.com",
      to: "denizlg24.com",
    });
  });

  it("gives a preview no stable domains at all", () => {
    const routing = planRouting(preview, [
      { hostname: "denizlg24.com", redirectTo: null },
    ]);

    expect(routing.serve).toEqual(["pr-4.denizlg24.com"]);
    expect(routing.redirects).toEqual([]);
  });
});
