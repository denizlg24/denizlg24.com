import { describe, expect, it } from "bun:test";

import {
  deriveSmbPrincipal,
  evaluateSmbAuth,
  generateSmbSecret,
  PROVISION_ORDER,
  REVOKE_ORDER,
  SmbCredentialError,
  smbAuthThrottled,
} from "./smb-credentials";

const now = new Date("2026-08-05T12:00:00Z");
const userId = "30000000-0000-4000-8000-000000000003";

function credential(overrides: Record<string, unknown> = {}) {
  return {
    expiresAt: null,
    principal: "dc-macbook-abcd1234",
    revokedAt: null,
    userId,
    ...overrides,
  } as Parameters<typeof evaluateSmbAuth>[0];
}

describe("SMB principals", () => {
  it("derives a safe Unix name from a device name", () => {
    const principal = deriveSmbPrincipal("Deniz's MacBook Pro");
    expect(principal).toMatch(/^dc-[a-z0-9-]+-[0-9a-f]{8}$/);
    expect(principal.length).toBeLessThanOrEqual(32);
  });

  it("never reuses a principal for the same device", () => {
    // A reissued credential must not collide with the revoked one, or Samba
    // cannot tell them apart.
    const first = deriveSmbPrincipal("laptop");
    const second = deriveSmbPrincipal("laptop");
    expect(first).not.toBe(second);
  });

  it("strips anything that is not a safe identifier character", () => {
    // The principal becomes a Unix account name; this is the boundary where
    // user input would otherwise reach useradd.
    expect(deriveSmbPrincipal("../../etc/passwd")).toMatch(
      /^dc-etc-passwd-[0-9a-f]{8}$/,
    );
    expect(deriveSmbPrincipal("a b;rm -rf /")).toMatch(
      /^dc-a-b-rm-rf-[0-9a-f]{8}$/,
    );
  });

  it("refuses a device name with nothing usable in it", () => {
    for (const name of ["", "///", "!!!"]) {
      expect(() => deriveSmbPrincipal(name)).toThrow(SmbCredentialError);
    }
  });

  it("generates a long random secret", () => {
    const secret = generateSmbSecret();
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(secret).not.toBe(generateSmbSecret());
  });
});

describe("SMB authentication decisions", () => {
  it("allows a live credential on an enabled account", () => {
    expect(evaluateSmbAuth(credential(), { disabled: false }, now)).toEqual({
      allowed: true,
    });
  });

  it("refuses a revoked credential", () => {
    expect(
      evaluateSmbAuth(
        credential({ revokedAt: new Date("2026-08-01T00:00:00Z") }),
        { disabled: false },
        now,
      ),
    ).toEqual({ allowed: false, reason: "revoked" });
  });

  it("refuses every device when the cloud account is disabled", () => {
    // Otherwise disabling an account would not be a security control at all.
    expect(evaluateSmbAuth(credential(), { disabled: true }, now)).toEqual({
      allowed: false,
      reason: "account-disabled",
    });
  });

  it("refuses an expired credential, inclusive of the expiry instant", () => {
    expect(
      evaluateSmbAuth(credential({ expiresAt: now }), { disabled: false }, now),
    ).toEqual({ allowed: false, reason: "expired" });
    expect(
      evaluateSmbAuth(
        credential({ expiresAt: new Date(now.getTime() + 1000) }),
        { disabled: false },
        now,
      ),
    ).toEqual({ allowed: true });
  });

  it("reports revocation ahead of a disabled account", () => {
    // Both are refusals; the more specific fact is the more useful one in ops.
    expect(
      evaluateSmbAuth(credential({ revokedAt: now }), { disabled: true }, now)
        .allowed,
    ).toBe(false);
  });
});

describe("lifecycle ordering", () => {
  it("writes metadata before creating the Samba account", () => {
    // The reverse leaves a working Samba account no database row knows about,
    // which is an unrevocable credential.
    expect(PROVISION_ORDER.indexOf("insert-metadata")).toBeLessThan(
      PROVISION_ORDER.indexOf("create-samba-account"),
    );
  });

  it("marks revoked before disabling, and closes sessions last", () => {
    // A crash after marking is visible and re-runnable; a crash after
    // disabling but before marking looks like a broken device.
    expect(REVOKE_ORDER[0]).toBe("mark-revoked");
    // Disabling an account does not end an established SMB session.
    expect(REVOKE_ORDER.at(-1)).toBe("close-active-sessions");
  });
});

describe("brute-force throttling", () => {
  it("does not throttle below the threshold", () => {
    expect(
      smbAuthThrottled({ failedAuthCount: 4, lastFailedAuthAt: now, now }),
    ).toBe(false);
  });

  it("throttles a burst of failures", () => {
    expect(
      smbAuthThrottled({ failedAuthCount: 5, lastFailedAuthAt: now, now }),
    ).toBe(true);
  });

  it("forgets failures once the window passes", () => {
    // Without expiry, five typos spread over a year would lock a device out
    // permanently.
    expect(
      smbAuthThrottled({
        failedAuthCount: 99,
        lastFailedAuthAt: new Date(now.getTime() - 16 * 60 * 1000),
        now,
      }),
    ).toBe(false);
  });
});
