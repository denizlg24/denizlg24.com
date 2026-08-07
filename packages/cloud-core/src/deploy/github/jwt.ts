import {
  createHmac,
  createPrivateKey,
  createSign,
  timingSafeEqual,
} from "node:crypto";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * A PEM carries newlines, which most secret stores and every `.env` file
 * mangle. Base64 of the whole PEM is accepted for that reason, and the escaped
 * `\n` form because that is what people paste when the base64 form is not
 * documented.
 */
export function readGithubPrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed.replaceAll("\\n", "\n");
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN")) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is neither a PEM nor base64 of one",
    );
  }
  return decoded;
}

export interface AppJwtOptions {
  appId: string;
  privateKey: string;
  now?: () => number;
}

/**
 * `iat` is backdated a minute on purpose. GitHub rejects a JWT whose `iat` is
 * in *its* future and says only "'Issued at' claim is in the future"; a few
 * seconds of ordinary clock skew is enough to trigger it, and the error names
 * nothing you can act on. Ten minutes is the maximum lifetime GitHub accepts,
 * so `exp` sits at nine to leave the same margin at the other end.
 */
export function createAppJwt(options: AppJwtOptions): string {
  const now = Math.floor((options.now ?? Date.now)() / 1_000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: options.appId }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = base64url(
    signer.sign(createPrivateKey(readGithubPrivateKey(options.privateKey))),
  );
  return `${header}.${payload}.${signature}`;
}

/**
 * Constant-time, and length-checked first because `timingSafeEqual` throws on a
 * length mismatch rather than returning false. A missing or malformed header is
 * a rejection, never a pass — this is the only thing standing between the
 * webhook and anyone who knows the URL.
 */
export function verifyGithubSignature(
  secret: string,
  rawBody: string | Uint8Array,
  header: string | null | undefined,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = header.slice("sha256=".length);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
