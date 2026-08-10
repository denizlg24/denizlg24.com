import { describe, expect, it } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { Database } from "../db";
import type { DeployDomainRow } from "../db/schema";
import {
  defaultDomainMode,
  isZoneHostname,
  planRouting,
  supersedeGeneratedDomains,
  sweepDeployDomains,
} from "./domains";

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

describe("sweepDeployDomains", () => {
  it("encodes timestamp cutoffs through their columns", async () => {
    const conditions: SQL[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: async (condition: SQL) => {
            conditions.push(condition);
            return [];
          },
        }),
      }),
    } as unknown as Database;

    await sweepDeployDomains(
      {
        db,
        dns: null,
        customHostnames: null,
        zoneName: ZONE,
      },
      { now: () => Date.parse("2026-08-09T19:14:54.000Z") },
    );

    const dialect = new PgDialect();
    expect(
      conditions.flatMap((condition) =>
        dialect
          .sqlToQuery(condition)
          .params.filter((value) => String(value).includes("2026-08-08")),
      ),
    ).toEqual(["2026-08-08T19:14:54.000Z", "2026-08-08T19:14:54.000Z"]);
  });
});

describe("supersedeGeneratedDomains", () => {
  interface Generated {
    id: string;
    isPrimary: boolean;
  }

  /**
   * Records what was written rather than emulating Postgres. The behaviour worth
   * pinning is the order: primary has to move before the generated row is
   * retired, or the target is briefly left with no URL to show.
   */
  function fakeDb(generated: Generated[]) {
    const retired: string[][] = [];
    const promoted: string[] = [];
    const demoted: string[][] = [];
    const db = {
      select: () => ({
        from: () => ({ where: async () => generated }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: (condition: SQL) => {
            const dialect = new PgDialect();
            const ids = dialect
              .sqlToQuery(condition)
              .params.filter(
                (value): value is string => typeof value === "string",
              );
            if ("retiredAt" in values) retired.push(ids);
            else if (values.isPrimary === true) promoted.push(...ids);
            else if (values.isPrimary === false) demoted.push(ids);
            return {
              returning: async () => [
                { ...row("manual", "active"), isPrimary: true },
              ],
            };
          },
        }),
      }),
    } as unknown as Database;
    return { db, retired, promoted, demoted };
  }

  function row(
    origin: "generated" | "manual",
    status: "active" | "verifying",
    isPrimary = false,
  ): DeployDomainRow {
    return {
      id: "arrival",
      targetId: "target-a",
      hostname: "shop.example.com",
      mode: "custom_hostname",
      origin,
      isPrimary,
      redirectTo: null,
      zoneId: null,
      dnsRecordId: null,
      customHostnameId: "ch-1",
      status,
      verification: null,
      lastCheckedAt: null,
      retiredAt: null,
      createdAt: new Date("2026-08-01T00:00:00Z"),
    };
  }

  it("retires the generated domain and moves primary onto the new one", async () => {
    const { db, retired, promoted, demoted } = fakeDb([
      { id: "gen-1", isPrimary: true },
    ]);
    const result = await supersedeGeneratedDomains(db, row("manual", "active"));

    expect(promoted).toEqual(["arrival"]);
    expect(demoted[0]).toEqual(["gen-1"]);
    expect(retired[0]).toEqual(["gen-1"]);
    expect(result.isPrimary).toBe(true);
  });

  // The generated name is the only one resolving until Cloudflare sees the
  // owner's DNS records. Retiring it here would take the service off the air.
  it("leaves everything alone while the new domain is still verifying", async () => {
    const { db, retired, promoted } = fakeDb([
      { id: "gen-1", isPrimary: true },
    ]);
    await supersedeGeneratedDomains(db, row("manual", "verifying"));

    expect(retired).toEqual([]);
    expect(promoted).toEqual([]);
  });

  it("ignores a generated domain going active", async () => {
    const { db, retired } = fakeDb([{ id: "gen-1", isPrimary: true }]);
    await supersedeGeneratedDomains(db, row("generated", "active"));
    expect(retired).toEqual([]);
  });

  it("does nothing when the target has no generated domain left", async () => {
    const { db, retired, promoted } = fakeDb([]);
    await supersedeGeneratedDomains(db, row("manual", "active"));
    expect(retired).toEqual([]);
    expect(promoted).toEqual([]);
  });

  it("retires without touching primary when the new domain already holds it", async () => {
    const { db, retired, promoted } = fakeDb([
      { id: "gen-1", isPrimary: false },
    ]);
    await supersedeGeneratedDomains(db, row("manual", "active", true));

    expect(promoted).toEqual([]);
    expect(retired[0]).toEqual(["gen-1"]);
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

  it("serves a domain whose redirect destination is unavailable", () => {
    const routing = planRouting(production, [
      { hostname: "www.denizlg24.com", redirectTo: "missing.denizlg24.com" },
      { hostname: "denizlg24.com", redirectTo: null },
    ]);

    expect(routing.serve).toContain("www.denizlg24.com");
    expect(routing.redirects).toEqual([]);
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
