import { createPrivateKey, type KeyObject, sign } from "node:crypto";
import type { MacrosTestFlightSignupResponse } from "@repo/schemas/macros";
import { normalizePrivateKeyPem } from "@/lib/push/jwt";

const ASC_BASE_URL = "https://api.appstoreconnect.apple.com";
const REQUEST_TIMEOUT_MS = 10_000;
// Apple refuses tokens living past 20 minutes; reuse one for 10.
const TOKEN_LIFETIME_SECONDS = 20 * 60;
const TOKEN_REUSE_SECONDS = 10 * 60;

export class TestFlightError extends Error {
  constructor(
    message: string,
    readonly configured: boolean,
  ) {
    super(message);
    this.name = "TestFlightError";
  }
}

type AscConfig = {
  keyId: string;
  issuerId: string;
  privateKey: KeyObject;
  groupId: string;
};

let cachedConfig: AscConfig | null = null;
let cachedToken: { token: string; issuedAt: number } | null = null;

function ascConfig(): AscConfig {
  if (cachedConfig) return cachedConfig;
  const keyId = process.env.MACROS_ASC_KEY_ID;
  const issuerId = process.env.MACROS_ASC_ISSUER_ID;
  const privateKey = process.env.MACROS_ASC_PRIVATE_KEY;
  const groupId = process.env.MACROS_TESTFLIGHT_GROUP_ID;
  if (!keyId || !issuerId || !privateKey || !groupId) {
    throw new TestFlightError("TestFlight sign-up is not configured", false);
  }
  cachedConfig = {
    keyId,
    issuerId,
    privateKey: createPrivateKey({
      key: normalizePrivateKeyPem(privateKey),
      format: "pem",
    }),
    groupId,
  };
  return cachedConfig;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function ascToken(config: AscConfig): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedToken.issuedAt < TOKEN_REUSE_SECONDS) {
    return cachedToken.token;
  }
  const header = base64url(
    JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }),
  );
  const payload = base64url(
    JSON.stringify({
      iss: config.issuerId,
      iat: now,
      exp: now + TOKEN_LIFETIME_SECONDS,
      aud: "appstoreconnect-v1",
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  cachedToken = {
    token: `${signingInput}.${base64url(signature)}`,
    issuedAt: now,
  };
  return cachedToken.token;
}

async function ascRequest(
  config: AscConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${ASC_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ascToken(config)}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function failure(response: Response, action: string) {
  const detail = await response.text().catch(() => "");
  return new TestFlightError(
    `${action} failed with ${response.status}: ${detail.slice(0, 500)}`,
    true,
  );
}

async function findTester(
  config: AscConfig,
  email: string,
  groupId?: string,
): Promise<string | null> {
  const group = groupId ? `&filter[betaGroups]=${groupId}` : "";
  const lookup = await ascRequest(
    config,
    "GET",
    `/v1/betaTesters?filter[email]=${encodeURIComponent(email)}${group}&fields[betaTesters]=email&limit=1`,
  );
  if (!lookup.ok) throw await failure(lookup, "Looking up the beta tester");
  const found: { data?: Array<{ id: string }> } = await lookup.json();
  return found.data?.[0]?.id ?? null;
}

/**
 * Adds the address to the public TestFlight group. Apple emails the invite
 * itself, and holds it until the group has a build that passed beta review.
 * An address Apple already knows (409) is added to the group instead, so
 * signing up twice is harmless.
 */
export async function inviteToTestFlight(tester: {
  email: string;
  firstName?: string;
  lastName?: string;
}): Promise<MacrosTestFlightSignupResponse> {
  const config = ascConfig();
  const created = await ascRequest(config, "POST", "/v1/betaTesters", {
    data: {
      type: "betaTesters",
      attributes: {
        email: tester.email,
        firstName: tester.firstName || undefined,
        lastName: tester.lastName || undefined,
      },
      relationships: {
        betaGroups: {
          data: [{ type: "betaGroups", id: config.groupId }],
        },
      },
    },
  });
  if (created.ok) return { status: "invited" };
  if (created.status !== 409) {
    throw await failure(created, "Creating the beta tester");
  }

  // Apple answers 409 to adding someone already in the group, so check first.
  const inGroup = await findTester(config, tester.email, config.groupId);
  if (inGroup) return { status: "already-invited" };
  const testerId = await findTester(config, tester.email);
  if (!testerId) {
    throw new TestFlightError(
      "Apple reported a conflict but has no tester with that email",
      true,
    );
  }

  const added = await ascRequest(
    config,
    "POST",
    `/v1/betaGroups/${config.groupId}/relationships/betaTesters`,
    { data: [{ type: "betaTesters", id: testerId }] },
  );
  if (!added.ok) throw await failure(added, "Adding the tester to the group");
  return { status: "already-invited" };
}
