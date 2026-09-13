import { describe, expect, mock, test } from "bun:test";
import { Types } from "mongoose";
import type { EncryptedSecret } from "@/lib/encrypted-secret";
import type {
  IConnectorOAuth,
  IConnectorOAuthClient,
} from "@/models/Connector";

// Other suites replace this module process-wide with fakes that ignore their
// input (bun never restores `mock.module`), and whichever ran last would decide
// what the provider decrypts. Pin one that round-trips.
function encryptSecret(secret: string): EncryptedSecret {
  return { ciphertext: secret, iv: "iv", authTag: "tag" };
}
mock.module("@/lib/encrypted-secret", () => ({
  encryptSecret,
  decryptSecret: (secret: EncryptedSecret) => secret.ciphertext,
}));

const { ConnectorOAuthProvider } = await import("./oauth-provider");

function provider(
  oauthClient?: IConnectorOAuthClient,
  oauth: IConnectorOAuth = {},
) {
  return new ConnectorOAuthProvider({
    _id: new Types.ObjectId(),
    oauth,
    oauthClient,
  });
}

describe("ConnectorOAuthProvider client information", () => {
  test("a hand-registered client replaces dynamic registration", () => {
    const registered = provider(
      {
        clientId: "Ov23li-client",
        clientSecret: encryptSecret("shh"),
        scope: "repo read:org",
      },
      {
        clientInformation: encryptSecret(
          JSON.stringify({ client_id: "dynamically-registered" }),
        ),
      },
    );
    expect(registered.clientInformation()).toEqual({
      client_id: "Ov23li-client",
      client_secret: "shh",
    });
    expect(registered.scope).toBe("repo read:org");
  });

  test("a client without a secret is sent as a public client", () => {
    expect(provider({ clientId: "public" }).clientInformation()).toEqual({
      client_id: "public",
    });
  });

  test("without one, the dynamically registered client is used", () => {
    const dynamic = provider(undefined, {
      clientInformation: encryptSecret(
        JSON.stringify({ client_id: "dynamically-registered" }),
      ),
    });
    expect(dynamic.clientInformation()).toEqual({
      client_id: "dynamically-registered",
    });
    expect(dynamic.scope).toBeUndefined();
    expect(provider().clientInformation()).toBeUndefined();
  });
});
