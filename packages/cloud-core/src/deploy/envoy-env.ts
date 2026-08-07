import type { DeployTargetRow } from "../db/schema";

/**
 * Envoy's blob format, for whoever ports the decrypt. Written down here because
 * it is the part that is expensive to rediscover, and getting a parameter wrong
 * produces wrong bytes rather than an error.
 *
 * ```
 * [1 byte version = 1][16 byte salt][24 byte nonce][ciphertext ‖ Poly1305 tag]
 * key = Argon2id(v0x13, m = 19456 KiB, t = 2, p = 1, out = 32) over the
 *       passphrase, salted with the 16 bytes above
 * cipher = XChaCha20-Poly1305
 * ```
 *
 * Two things this does not cover, both in `apps/envoy-cli/src/commands/crypto.rs`:
 * a manifest entry is either `Legacy` (the passphrase derives the file key
 * directly, as above) or carries a per-project key that is itself wrapped, and
 * the second path goes through `decrypt_file_bytes` instead. Node has neither
 * XChaCha20-Poly1305 nor raw Argon2id with a supplied salt, so both need a
 * dependency — `Bun.password` hashes to a PHC string and cannot derive a key.
 */
export const ENVOY_BLOB_VERSION = 1;

/**
 * What resolution step 2 needs. Kept as an injected interface rather than a
 * direct import so the control plane composes exactly as it will once a decrypt
 * exists, and so nothing has to change here when one does.
 */
export interface EnvoyEnvSource {
  /** The decrypted `.env` for a linked project, as a flat map. */
  read(input: {
    envoyProjectId: string;
    passphrase: string;
  }): Promise<Record<string, string>>;
}

export interface EnvoyLink {
  envoyProjectId: string;
  passphrase: string;
}

/**
 * The opt-in gate, and the only thing that decides whether Envoy is consulted.
 * A target with no link resolves exactly as it did before this existed —
 * detecting an Envoy project alongside is never enough on its own.
 */
export function envoyLinkFor(
  target: DeployTargetRow,
  // Matches `decryptDeployEnvValue`, which takes the nullable row shape. The
  // null checks below are what make the call safe, not the signature.
  decrypt: (row: {
    encryptedValue: string | null;
    valueIv: string | null;
    valueAuthTag: string | null;
    key: string;
  }) => string,
): EnvoyLink | null {
  if (
    !target.envoyProjectId ||
    !target.envoyPassphrase ||
    !target.envoyPassphraseIv ||
    !target.envoyPassphraseAuthTag
  ) {
    return null;
  }
  return {
    envoyProjectId: target.envoyProjectId,
    passphrase: decrypt({
      encryptedValue: target.envoyPassphrase,
      valueIv: target.envoyPassphraseIv,
      valueAuthTag: target.envoyPassphraseAuthTag,
      // Only ever surfaces in a decrypt-failure message, so it names the
      // column rather than pretending to be an environment variable.
      key: "envoyPassphrase",
    }),
  };
}

/**
 * Step 2 of resolution. Best-effort on purpose: Envoy is a second service on
 * another host, and a deploy that already has its literals and bindings must
 * not fail because that host is down. A missed pull shows up as a missing key
 * at run time, which the build log names — an outage that blocks every deploy
 * does not.
 */
export async function resolveEnvoyEnv(
  source: EnvoyEnvSource | null,
  link: EnvoyLink | null,
): Promise<Record<string, string>> {
  if (!source || !link) return {};
  try {
    return await source.read(link);
  } catch (error) {
    console.error("[deploy] Envoy env pull failed", error);
    return {};
  }
}
