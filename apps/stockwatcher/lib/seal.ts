import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

function key(purpose: string) {
  const material =
    process.env.BROKER_SECRET ||
    process.env.DENIZ_OIDC_CLIENT_SECRET ||
    (process.env.NODE_ENV !== "production" ? "stockwatcher-development" : "");
  if (!material) throw new Error("Set BROKER_SECRET to store credentials.");
  return Buffer.from(hkdfSync("sha256", material, "", purpose, 32));
}

/** AES-256-GCM with a key derived per purpose, so secrets of one kind can't be replayed as another. */
export function sealer(purpose: string) {
  return {
    seal(plain: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
      const body = Buffer.concat([
        cipher.update(plain, "utf8"),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), body]
        .map((part) => part.toString("base64url"))
        .join(".");
    },
    open(sealed: string) {
      const [iv, tag, body] = sealed
        .split(".")
        .map((part) => Buffer.from(part, "base64url"));
      if (!iv || !tag || !body)
        throw new Error("Stored credential is malformed.");
      const decipher = createDecipheriv("aes-256-gcm", key(purpose), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString(
        "utf8",
      );
    },
  };
}
