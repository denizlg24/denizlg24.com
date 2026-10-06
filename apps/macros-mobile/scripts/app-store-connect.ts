/**
 * Pure pieces of the ad-hoc profile tooling: the App Store Connect token, and
 * the decisions made over what the API and the Macros server return. No I/O,
 * so everything here is tested without a developer account.
 */
import { createPrivateKey, sign, X509Certificate } from "node:crypto";

export const ASC_AUDIENCE = "appstoreconnect-v1";
/** Apple refuses tokens that live longer than 20 minutes. */
export const ASC_TOKEN_SECONDS = 15 * 60;
/** iPhones per product family per membership year; deleting one frees nothing. */
export const DEVICE_YEARLY_CAP = 100;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function createAscToken({
  keyId,
  issuerId,
  privateKey,
  now = Date.now(),
}: {
  keyId: string;
  issuerId: string;
  /** The .p8 PEM exactly as downloaded. */
  privateKey: string;
  now?: number;
}): string {
  const issuedAt = Math.floor(now / 1000);
  const header = base64url(
    JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }),
  );
  const payload = base64url(
    JSON.stringify({
      iss: issuerId,
      iat: issuedAt,
      exp: issuedAt + ASC_TOKEN_SECONDS,
      aud: ASC_AUDIENCE,
    }),
  );
  const signingInput = `${header}.${payload}`;
  // JWS wants the raw r||s pair, not the DER signature node emits by default.
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${base64url(signature)}`;
}

export interface AscDevice {
  id: string;
  udid: string;
  status: "ENABLED" | "DISABLED" | "PROCESSING";
  platform: string;
  deviceClass?: string;
}

export interface ApprovedDevice {
  id: string;
  udid: string;
  name: string;
}

export function sameUdid(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

/**
 * Splits the server's approved list into devices Apple already knows (their
 * ids go straight back to the server) and devices still to register.
 */
export function planRegistrations(
  approved: readonly ApprovedDevice[],
  existing: readonly AscDevice[],
): {
  known: { request: ApprovedDevice; device: AscDevice }[];
  missing: ApprovedDevice[];
} {
  const known: { request: ApprovedDevice; device: AscDevice }[] = [];
  const missing: ApprovedDevice[] = [];
  for (const request of approved) {
    const device = existing.find((candidate) =>
      sameUdid(candidate.udid, request.udid),
    );
    if (device) known.push({ request, device });
    else missing.push(request);
  }
  return { known, missing };
}

/** Every enabled iOS device goes into the profile, not only the approved ones. */
export function profileDevices(devices: readonly AscDevice[]): AscDevice[] {
  return devices.filter(
    (device) => device.status === "ENABLED" && device.platform === "IOS",
  );
}

/** Apple caps device names at 50 characters. */
export function deviceName(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim() || "Macros tester";
  return cleaned.length <= 50 ? cleaned : cleaned.slice(0, 50).trimEnd();
}

export interface AscCertificate {
  id: string;
  certificateType: string;
  certificateContent: string;
}

/**
 * The profile must name the certificate whose key is in the p12 CI signs
 * with, so match on the DER fingerprint rather than trusting a type or name.
 */
export function findCertificate(
  certificates: readonly AscCertificate[],
  certificatePem: string,
): AscCertificate | undefined {
  const fingerprint = new X509Certificate(certificatePem).fingerprint256;
  return certificates.find((certificate) => {
    try {
      return (
        new X509Certificate(
          Buffer.from(certificate.certificateContent, "base64"),
        ).fingerprint256 === fingerprint
      );
    } catch {
      return false;
    }
  });
}

/** Shared by the app and its widget extension; `APP_GROUP` in app.config.ts. */
export const APP_GROUP = "group.com.denizlg24.macros";

/**
 * Every target the ad-hoc build signs, each with its own bundle id and
 * profile. Apple's API can enable App Groups on a bundle id but cannot assign
 * a group to it: that stays a one-time step in the developer portal.
 */
export const SIGNING_TARGETS = [
  {
    target: "Macros",
    bundleIdentifier: "com.denizlg24.macros",
    name: "Macros",
    profileName: "Macros Ad Hoc",
    capabilities: ["APP_GROUPS", "HEALTHKIT", "PUSH_NOTIFICATIONS"],
    entitlements: [
      "aps-environment",
      "com.apple.developer.healthkit",
      "com.apple.developer.healthkit.access",
      "com.apple.security.application-groups",
    ],
    required: [
      "aps-environment",
      "com.apple.developer.healthkit",
      "com.apple.security.application-groups",
    ],
  },
  {
    target: "MacrosWidgetExtension",
    bundleIdentifier: "com.denizlg24.macros.widgets",
    name: "Macros Widgets",
    profileName: "Macros Widgets Ad Hoc",
    capabilities: ["APP_GROUPS"],
    entitlements: ["com.apple.security.application-groups"],
    required: ["com.apple.security.application-groups"],
  },
] as const;

export type SigningTarget = (typeof SIGNING_TARGETS)[number];

export function signingTarget(name: string): SigningTarget {
  const target = SIGNING_TARGETS.find((candidate) => candidate.target === name);
  if (!target) {
    throw new Error(
      `Unknown target ${name}; expected ${SIGNING_TARGETS.map((candidate) => candidate.target).join(" or ")}`,
    );
  }
  return target;
}

export function missingCapabilities(
  present: readonly string[],
  target: SigningTarget = SIGNING_TARGETS[0],
): string[] {
  return target.capabilities.filter(
    (capability) => !present.includes(capability),
  );
}

/** What codesign adds to every signed target. */
const SIGNING_ENTITLEMENTS = [
  "application-identifier",
  "com.apple.developer.team-identifier",
  "get-task-allow",
  "keychain-access-groups",
];

/**
 * `signed: false` checks the entitlements file prebuild generates, before
 * codesign adds `get-task-allow`, so an unsigned CI build can run it too.
 */
export function entitlementProblems(
  entitlements: Record<string, unknown>,
  {
    signed = true,
    target = SIGNING_TARGETS[0],
  }: { signed?: boolean; target?: SigningTarget } = {},
): string[] {
  const allowed = new Set<string>([
    ...SIGNING_ENTITLEMENTS,
    ...target.entitlements,
  ]);
  const problems = Object.keys(entitlements)
    .filter((key) => !allowed.has(key))
    .map((key) => `unexpected entitlement ${key}`);
  if (signed && entitlements["get-task-allow"] !== false) {
    problems.push("get-task-allow must be false in a distribution build");
  }
  for (const key of target.required) {
    if (!(key in entitlements)) problems.push(`missing ${key}`);
  }
  const groups = entitlements["com.apple.security.application-groups"];
  if (
    groups !== undefined &&
    !(Array.isArray(groups) && groups.length === 1 && groups[0] === APP_GROUP)
  ) {
    problems.push(`the only App Group must be ${APP_GROUP}`);
  }
  return problems;
}
