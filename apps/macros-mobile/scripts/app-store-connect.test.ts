import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  ASC_AUDIENCE,
  ASC_TOKEN_SECONDS,
  createAscToken,
  entitlementProblems,
  findCertificate,
  missingCapabilities,
  signingTarget,
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
    expect(missingCapabilities(["PUSH_NOTIFICATIONS"])).toEqual([
      "APP_GROUPS",
      "HEALTHKIT",
    ]);
    expect(
      missingCapabilities(["APP_GROUPS", "HEALTHKIT", "PUSH_NOTIFICATIONS"]),
    ).toEqual([]);
  });

  test("asks only for an App Group on the widget extension", () => {
    const widgets = signingTarget("MacrosWidgetExtension");
    expect(missingCapabilities([], widgets)).toEqual(["APP_GROUPS"]);
    expect(missingCapabilities(["APP_GROUPS"], widgets)).toEqual([]);
  });
});

describe("entitlementProblems", () => {
  const signed = {
    "application-identifier": "TEAM.com.denizlg24.macros",
    "beta-reports-active": true,
    "com.apple.developer.team-identifier": "TEAM",
    "get-task-allow": false,
    "keychain-access-groups": ["TEAM.*"],
    "aps-environment": "production",
    "com.apple.developer.healthkit": true,
    "com.apple.developer.healthkit.access": [],
    "com.apple.security.application-groups": ["group.com.denizlg24.macros"],
  };

  test("accepts what an App Store Macros build should carry", () => {
    expect(entitlementProblems(signed)).toEqual([]);
    expect(signingTarget("Macros").profileName).toBe("Macros App Store");
    expect(signingTarget("MacrosWidgetExtension").profileName).toBe(
      "Macros Widgets App Store",
    );
  });

  test("refuses anything else, a debuggable build, or a missing capability", () => {
    const { "aps-environment": _aps, ...withoutPush } = signed;
    expect(
      entitlementProblems({
        ...withoutPush,
        "get-task-allow": true,
        "com.apple.developer.icloud-services": ["CloudKit"],
        "com.apple.security.application-groups": ["group.x"],
      }),
    ).toEqual([
      "unexpected entitlement com.apple.developer.icloud-services",
      "get-task-allow must be false in a distribution build",
      "missing aps-environment",
      "the only App Group must be group.com.denizlg24.macros",
    ]);
  });

  test("requires production APNs in a signed App Store app", () => {
    expect(
      entitlementProblems({ ...signed, "aps-environment": "development" }),
    ).toEqual(["aps-environment must be production in an App Store build"]);
  });

  test("holds the widget extension to the App Group alone", () => {
    const widgets = signingTarget("MacrosWidgetExtension");
    const extension = {
      "application-identifier": "TEAM.com.denizlg24.macros.widgets",
      "com.apple.developer.team-identifier": "TEAM",
      "get-task-allow": false,
      "com.apple.security.application-groups": ["group.com.denizlg24.macros"],
    };
    expect(entitlementProblems(extension, { target: widgets })).toEqual([]);
    expect(
      entitlementProblems(
        { ...extension, "com.apple.developer.healthkit": true },
        { target: widgets },
      ),
    ).toEqual(["unexpected entitlement com.apple.developer.healthkit"]);
  });

  test("checks a generated entitlements file without get-task-allow", () => {
    const generated = {
      "aps-environment": "production",
      "com.apple.developer.healthkit": true,
      "com.apple.developer.healthkit.access": [],
      "com.apple.security.application-groups": ["group.com.denizlg24.macros"],
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
