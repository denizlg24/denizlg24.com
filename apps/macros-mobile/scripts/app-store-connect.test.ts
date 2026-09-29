import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  ASC_AUDIENCE,
  ASC_TOKEN_SECONDS,
  type AscDevice,
  createAscToken,
  deviceName,
  entitlementProblems,
  findCertificate,
  missingCapabilities,
  planRegistrations,
  profileDevices,
} from "./app-store-connect";

// A self-signed P-256 certificate, only ever used to exercise the matcher.
const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBfTCCASOgAwIBAgIUHClXjPd86o1O9xdwFng/mXhtuEUwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbWFjcm9zLWNpMB4XDTI2MDkyOTA2MTgyNloXDTM2MDkyNjA2
MTgyNlowFDESMBAGA1UEAwwJbWFjcm9zLWNpMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEA4NhpaW7VsiIa34gPE2LBwoShcy/IMBMk/jzNTuOKFHewUeZpeFyJxlK
BOeNmuBJfJ7K/jwzGJc2zVqpT0fplKNTMFEwHQYDVR0OBBYEFApZLm9b471Fq/YG
Abe++eN48zhnMB8GA1UdIwQYMBaAFApZLm9b471Fq/YGAbe++eN48zhnMA8GA1Ud
EwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIhAMBW37RMo/s28l6H0tyw6gd+
8CgAyfAWO+D2ETLGnWyQAiBe3X/ViSW8+Zk80B2+rIpqY1rNxQAkd6T5LqcTp8Cr
0g==
-----END CERTIFICATE-----`;

function derBase64(pem: string) {
  return pem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

describe("createAscToken", () => {
  test("signs an ES256 JWT App Store Connect accepts", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const now = 1_700_000_000_000;
    const token = createAscToken({
      keyId: "KEY123",
      issuerId: "issuer-uuid",
      privateKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      now,
    });

    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) throw new Error("not a JWT");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY123",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iss: "issuer-uuid",
      iat: now / 1000,
      exp: now / 1000 + ASC_TOKEN_SECONDS,
      aud: ASC_AUDIENCE,
    });
    const raw = Buffer.from(signature, "base64url");
    expect(raw.length).toBe(64);
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        raw,
      ),
    ).toBe(true);
  });
});

const device = (overrides: Partial<AscDevice>): AscDevice => ({
  id: "D1",
  udid: "00008030-001A2B3C4D5E6F70",
  status: "ENABLED",
  platform: "IOS",
  ...overrides,
});

describe("planRegistrations", () => {
  test("matches UDIDs case-insensitively and leaves the rest to register", () => {
    const plan = planRegistrations(
      [
        { id: "r1", udid: "00008030-001A2B3C4D5E6F70", name: "Ana" },
        { id: "r2", udid: "A".repeat(40), name: "Rui" },
      ],
      [device({ udid: "00008030-001a2b3c4d5e6f70" })],
    );
    expect(plan.known.map((item) => [item.request.id, item.device.id])).toEqual(
      [["r1", "D1"]],
    );
    expect(plan.missing.map((item) => item.id)).toEqual(["r2"]);
  });
});

describe("profileDevices", () => {
  test("keeps enabled iOS devices only", () => {
    const devices = [
      device({ id: "a" }),
      device({ id: "b", status: "DISABLED" }),
      device({ id: "c", platform: "MAC_OS" }),
      device({ id: "d", status: "PROCESSING" }),
    ];
    expect(profileDevices(devices).map((item) => item.id)).toEqual(["a"]);
  });
});

describe("deviceName", () => {
  test("collapses whitespace and stays within 50 characters", () => {
    expect(deviceName("  Ana   Silva ")).toBe("Ana Silva");
    expect(deviceName("x".repeat(80))).toHaveLength(50);
    expect(deviceName("   ")).toBe("Macros tester");
  });
});

describe("findCertificate", () => {
  test("matches on the certificate itself", () => {
    const match = findCertificate(
      [
        {
          id: "junk",
          certificateType: "DISTRIBUTION",
          certificateContent: "AAAA",
        },
        {
          id: "dist",
          certificateType: "DISTRIBUTION",
          certificateContent: derBase64(CERT_PEM),
        },
      ],
      CERT_PEM,
    );
    expect(match?.id).toBe("dist");
  });
});

describe("missingCapabilities", () => {
  test("names what the bundle id still lacks", () => {
    expect(missingCapabilities(["PUSH_NOTIFICATIONS"])).toEqual(["HEALTHKIT"]);
    expect(missingCapabilities(["HEALTHKIT", "PUSH_NOTIFICATIONS"])).toEqual(
      [],
    );
  });
});

describe("entitlementProblems", () => {
  const signed = {
    "application-identifier": "TEAM.com.denizlg24.macros",
    "com.apple.developer.team-identifier": "TEAM",
    "get-task-allow": false,
    "keychain-access-groups": ["TEAM.*"],
    "aps-environment": "production",
    "com.apple.developer.healthkit": true,
    "com.apple.developer.healthkit.access": [],
  };

  test("accepts what an ad-hoc Macros build should carry", () => {
    expect(entitlementProblems(signed)).toEqual([]);
  });

  test("refuses anything else, a debuggable build, or a missing capability", () => {
    const { "aps-environment": _aps, ...withoutPush } = signed;
    expect(
      entitlementProblems({
        ...withoutPush,
        "get-task-allow": true,
        "com.apple.security.application-groups": ["group.x"],
      }),
    ).toEqual([
      "unexpected entitlement com.apple.security.application-groups",
      "get-task-allow must be false in a distribution build",
      "missing aps-environment",
    ]);
  });

  test("checks a generated entitlements file without get-task-allow", () => {
    const generated = {
      "aps-environment": "production",
      "com.apple.developer.healthkit": true,
      "com.apple.developer.healthkit.access": [],
    };
    expect(entitlementProblems(generated, { signed: false })).toEqual([]);
    expect(entitlementProblems(generated)).toEqual([
      "get-task-allow must be false in a distribution build",
    ]);
    expect(
      entitlementProblems(
        { ...generated, "com.apple.developer.icloud-services": ["CloudKit"] },
        { signed: false },
      ),
    ).toEqual(["unexpected entitlement com.apple.developer.icloud-services"]);
  });
});
