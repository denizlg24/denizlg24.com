import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { tool } from "ai";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { z } from "zod";
import { chatgptCredentialSchema, credentialExpiresAt } from "./contract";

mock.module("@/lib/mongodb", () => ({ connectDB: async () => {} }));
const { AiSubscriptionSettings } = await import(
  "@/models/AiSubscriptionSettings"
);
const {
  chatgptAccessToken,
  disconnectSubscription,
  subscriptionStatus,
  updateSubscription,
} = await import("./service");
const { subscriptionRequestBody, chatgptSubscriptionTools } = await import(
  "@/lib/llm-transports/chatgpt-subscription"
);
const { encryptSecret, decryptSecret } = await import("@/lib/encrypted-secret");
const oldFetch = globalThis.fetch;
const oldEncryptionKey = process.env.IMAP_ENCRYPTION_KEY;
let mongo: MongoMemoryServer;
const record = () => ({
  issuer: "https://auth.openai.com" as const,
  subject: "test-owner",
  client_id: "oaiapp_test",
  ext_agent_host_id: "urn:uuid:809a63b3-b247-4ed3-9059-51bb28fa6367",
  id_token: "protected-test-id",
  access_token: "old-subscription-access",
  refresh_token: "one-use-refresh",
  token_type: "Bearer" as const,
  expires_in: 3600,
  scopes: ["chatgpt.tokens.use.direct", "resource.invoke", "offline_access"],
  saved_at: new Date(Date.now() - 7200_000).toISOString(),
});
beforeAll(async () => {
  process.env.IMAP_ENCRYPTION_KEY = "ab".repeat(32);
  mongo = await MongoMemoryServer.create({ binary: { version: "8.2.1" } });
  await mongoose.connect(mongo.getUri(), {
    dbName: "subscription-connections-test",
  });
}, 30_000);
beforeEach(async () => {
  globalThis.fetch = oldFetch;
  await AiSubscriptionSettings.deleteMany({});
});
afterAll(async () => {
  globalThis.fetch = oldFetch;
  if (oldEncryptionKey === undefined) delete process.env.IMAP_ENCRYPTION_KEY;
  else process.env.IMAP_ENCRYPTION_KEY = oldEncryptionKey;
  await mongoose.disconnect();
  await mongo?.stop();
});
async function seed() {
  const credential = record();
  await AiSubscriptionSettings.create({
    _id: "singleton",
    activeProvider: "chatgpt",
    hostId: credential.ext_agent_host_id,
    chatgpt: {
      secret: encryptSecret(JSON.stringify(credential)),
      model: "account-model",
      expiresAt: credentialExpiresAt(credential),
      revision: "original-generation",
    },
  });
}

describe("personal subscription credentials", () => {
  test("rejects identity-only credentials and registration placeholder clients", () => {
    expect(
      chatgptCredentialSchema.safeParse({ ...record(), scopes: ["openid"] })
        .success,
    ).toBe(false);
    expect(
      chatgptCredentialSchema.safeParse({
        ...record(),
        client_id: "dynamic_agent_client",
      }).success,
    ).toBe(false);
  });
  test("concurrent requests consume a rotating refresh token exactly once", async () => {
    await seed();
    let calls = 0;
    globalThis.fetch = Object.assign(
      async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return Response.json({
          access_token: "renewed-access",
          refresh_token: "replacement-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope: record().scopes.join(" "),
        });
      },
      { preconnect: oldFetch.preconnect },
    );
    expect(
      await Promise.all(Array.from({ length: 8 }, () => chatgptAccessToken())),
    ).toEqual(Array(8).fill("renewed-access"));
    expect(calls).toBe(1);
    const saved = await AiSubscriptionSettings.findById("singleton")
      .lean()
      .orFail();
    expect(JSON.parse(decryptSecret(saved.chatgpt!.secret)).refresh_token).toBe(
      "replacement-refresh",
    );
    expect(saved.chatgpt!.secret.ciphertext).not.toContain(
      "replacement-refresh",
    );
    expect(JSON.stringify(await subscriptionStatus())).not.toContain(
      "renewed-access",
    );
  });
  test("disconnect during renewal cannot resurrect credentials or switch billing", async () => {
    await seed();
    globalThis.fetch = Object.assign(
      async (url: Parameters<typeof fetch>[0]) => {
        if (String(url).endsWith("/revoke"))
          return new Response(null, { status: 200 });
        await disconnectSubscription("chatgpt");
        return Response.json({
          access_token: "stale-access",
          refresh_token: "stale-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope: record().scopes.join(" "),
        });
      },
      { preconnect: oldFetch.preconnect },
    );
    await expect(chatgptAccessToken()).rejects.toThrow("connection changed");
    const status = await subscriptionStatus();
    expect(status.chatgpt.configured).toBe(false);
    expect(status.activeProvider).toBe("chatgpt");
    await expect(chatgptAccessToken()).rejects.toThrow("disconnected");
  });
  test("a revoked subscription fails without trying an API key or Gateway", async () => {
    await seed();
    const requests: string[] = [];
    globalThis.fetch = Object.assign(
      async (url: Parameters<typeof fetch>[0]) => {
        requests.push(String(url));
        return new Response("revoked", { status: 401 });
      },
      { preconnect: oldFetch.preconnect },
    );
    await expect(chatgptAccessToken()).rejects.toThrow("sign-in expired");
    await expect(chatgptAccessToken()).rejects.toThrow("fresh sign-in");
    expect(requests).toEqual([
      "https://auth.openai.com/api/accounts/oauth/token",
    ]);
  });
  test("does not mistake an Anthropic API key for subscription authentication", async () => {
    await expect(
      updateSubscription({
        provider: "claude-code",
        token: "sk-ant-api-test",
        model: "claude-test",
      }),
    ).rejects.toThrow("subscription setup token");
  });
  test("an interrupted renewal is never replayed after its lease expires", async () => {
    await seed();
    await AiSubscriptionSettings.updateOne(
      { _id: "singleton" },
      { $set: { "chatgpt.refreshUntil": new Date(Date.now() - 1000) } },
    );
    const network = mock(async () => {
      throw new Error("Must not replay");
    });
    globalThis.fetch = Object.assign(network, {
      preconnect: oldFetch.preconnect,
    });
    await expect(chatgptAccessToken()).rejects.toThrow(
      "renewal was interrupted",
    );
    expect(network).not.toHaveBeenCalled();
  });
});

describe("ChatGPT preview request compatibility", () => {
  test("forces stateless streaming and removes fields the plan route rejects", () => {
    const body = JSON.parse(
      subscriptionRequestBody(
        JSON.stringify({
          model: "account-model",
          store: true,
          stream: false,
          max_output_tokens: 1000,
          temperature: 0.2,
          previous_response_id: "previous",
          background: true,
          instructions: "Help",
          input: [{ role: "user", content: "Hello" }],
        }),
      ),
    );
    expect(body).toEqual({
      model: "account-model",
      store: false,
      stream: true,
      instructions: "Help",
      input: [{ role: "user", content: "Hello" }],
    });
  });
  test("namespaces app tools while preserving their host approvals and executors", () => {
    const execute = mock(async () => "done");
    const original = tool({
      inputSchema: z.object({ id: z.string() }),
      needsApproval: true,
      execute,
    });
    const wrapped = chatgptSubscriptionTools({ mutate: original }).mutate!;
    expect(wrapped.needsApproval).toBe(true);
    expect(wrapped.execute).toBe(original.execute);
    expect(wrapped.providerOptions?.openai).toMatchObject({
      namespace: { name: "dashboard" },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
