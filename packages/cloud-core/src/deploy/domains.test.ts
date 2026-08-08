import { describe, expect, it } from "bun:test";

import { defaultDomainMode, isZoneHostname } from "./domains";

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
