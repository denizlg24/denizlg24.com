import { describe, expect, test } from "bun:test";

import {
  decryptRecoveryEnvironment,
  encryptRecoveryEnvironment,
} from "./routes";

const DEPLOYMENT_ID = "11111111-1111-4111-8111-111111111111";
const KEY = "test-deploy-environment-encryption-key";

describe("Forge recovery environment envelope", () => {
  test("round-trips exact values without placing plaintext in the envelope", () => {
    const env = {
      DATABASE_URL: "postgresql://user:secret@postgres/cloud",
      MULTILINE: "first\nsecond",
    };
    const envelope = encryptRecoveryEnvironment(env, KEY);

    expect(JSON.stringify(envelope)).not.toContain("user:secret");
    expect(envelope.environmentHmacSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      decryptRecoveryEnvironment(
        { deploymentId: DEPLOYMENT_ID, ...envelope },
        KEY,
      ),
    ).toEqual(env);
  });

  test("rejects both ciphertext tampering and a semantic checksum mismatch", () => {
    const envelope = encryptRecoveryEnvironment({ SECRET: "value" }, KEY);
    expect(() =>
      decryptRecoveryEnvironment(
        {
          deploymentId: DEPLOYMENT_ID,
          ...envelope,
          environmentCipher: {
            ...envelope.environmentCipher,
            encrypted: `${envelope.environmentCipher.encrypted.slice(0, -1)}A`,
          },
        },
        KEY,
      ),
    ).toThrow();
    expect(() =>
      decryptRecoveryEnvironment(
        {
          deploymentId: DEPLOYMENT_ID,
          ...envelope,
          environmentHmacSha256: "f".repeat(64),
        },
        KEY,
      ),
    ).toThrow(/semantic checksum/);
  });
});
