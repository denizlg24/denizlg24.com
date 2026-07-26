import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import type {
  PeekableRateLimitStore,
  RateLimitDecision,
} from "../middleware/rate-limit";
import type { SafeUserRecord } from "../services/types";
import { davAuth } from "./auth";
import { generateDavSecret } from "./credentials";
import type { DavVariables } from "./routes";

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  username: "owner",
  email: null,
  role: "user",
  status: "active",
  totpEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies SafeUserRecord;

function appWith(secret: string) {
  const seen: Array<{ username: string; secret: string }> = [];
  const app = new Hono<{ Variables: DavVariables }>();
  app.use(
    "*",
    davAuth({
      resolve: async (username, candidate) => {
        seen.push({ username, secret: candidate });
        return username === user.username && candidate === secret ? user : null;
      },
    }),
  );
  app.get("/", (context) => context.text(context.get("user").username));
  app.on("OPTIONS", "/", (context) => context.body(null, 200));
  return { app, seen };
}

function basic(username: string, secret: string): string {
  return `Basic ${Buffer.from(`${username}:${secret}`, "utf8").toString("base64")}`;
}

class CountingStore implements PeekableRateLimitStore {
  readonly hits = new Map<string, number>();
  consumeCalls = 0;

  async consume(key: string, max: number): Promise<RateLimitDecision> {
    this.consumeCalls += 1;
    const next = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, next);
    return next > max
      ? { allowed: false, retryAfterMs: 30_000 }
      : { allowed: true, retryAfterMs: 0 };
  }

  async peek(key: string, max: number): Promise<RateLimitDecision> {
    return (this.hits.get(key) ?? 0) >= max
      ? { allowed: false, retryAfterMs: 30_000 }
      : { allowed: true, retryAfterMs: 0 };
  }
}

function throttledApp(secret: string, max: number) {
  const store = new CountingStore();
  const seen: string[] = [];
  const app = new Hono<{ Variables: DavVariables }>();
  app.use(
    "*",
    davAuth({
      resolve: async (username, candidate) => {
        seen.push(candidate);
        return username === user.username && candidate === secret ? user : null;
      },
      throttle: {
        store,
        max,
        windowMs: 900_000,
        clientKey: () => "dav-auth:203.0.113.8",
      },
    }),
  );
  app.get("/", (context) => context.text(context.get("user").username));
  app.on("OPTIONS", "/", (context) => context.body(null, 200));
  return { app, store, seen };
}

describe("dav basic auth", () => {
  it("challenges with a realm the OS mount dialogs understand", async () => {
    const { app } = appWith("s3cret");
    const response = await app.request("/");
    expect(response.status).toBe(401);
    // charset=UTF-8 is what makes both clients send the password as UTF-8.
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Basic realm="Deniz Cloud", charset="UTF-8"',
    );
  });

  it("lets OPTIONS through unauthenticated so clients can discover the class", async () => {
    const { app } = appWith("s3cret");
    const response = await app.request("/", { method: "OPTIONS" });
    expect(response.status).toBe(200);
  });

  it("accepts a valid credential and exposes the user", async () => {
    const { app } = appWith("s3cret");
    const response = await app.request("/", {
      headers: { Authorization: basic("owner", "s3cret") },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("owner");
  });

  it("challenges again on a wrong secret", async () => {
    const { app } = appWith("s3cret");
    const response = await app.request("/", {
      headers: { Authorization: basic("owner", "wrong") },
    });
    expect(response.status).toBe(401);
  });

  it("splits on the first colon so a secret may contain one", async () => {
    const { app, seen } = appWith("a:b:c");
    const response = await app.request("/", {
      headers: { Authorization: basic("owner", "a:b:c") },
    });
    expect(response.status).toBe(200);
    expect(seen.at(-1)).toEqual({ username: "owner", secret: "a:b:c" });
  });

  it("decodes non-ASCII credentials as UTF-8", async () => {
    const { app, seen } = appWith("pässwörd");
    const response = await app.request("/", {
      headers: { Authorization: basic("owner", "pässwörd") },
    });
    expect(response.status).toBe(200);
    expect(seen.at(-1)?.secret).toBe("pässwörd");
  });

  it("rejects a non-Basic scheme without consulting the resolver", async () => {
    const { app, seen } = appWith("s3cret");
    const response = await app.request("/", {
      headers: { Authorization: "Bearer some-api-key" },
    });
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(0);
  });
});

describe("dav auth throttling", () => {
  it("never charges a successful request", async () => {
    const { app, store } = throttledApp("s3cret", 3);
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await app.request("/", {
        headers: { Authorization: basic("owner", "s3cret") },
      });
      expect(response.status).toBe(200);
    }
    // A mounted drive re-sends its credentials on every request; charging per
    // request rather than per rejection would throttle ordinary browsing.
    expect(store.consumeCalls).toBe(0);
  });

  it("does not charge a request that carried no credentials", async () => {
    const { app, store } = throttledApp("s3cret", 3);
    const response = await app.request("/");
    expect(response.status).toBe(401);
    expect(store.consumeCalls).toBe(0);
  });

  it("charges each rejection and answers 429 past the ceiling", async () => {
    const { app, store } = throttledApp("s3cret", 3);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await app.request("/", {
        headers: { Authorization: basic("owner", "wrong") },
      });
      expect(response.status).toBe(401);
    }
    expect(store.consumeCalls).toBe(3);

    const blocked = await app.request("/", {
      headers: { Authorization: basic("owner", "wrong") },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("30");
  });

  it("refuses a barred client before verifying the password", async () => {
    const { app, store, seen } = throttledApp("s3cret", 2);
    await app.request("/", {
      headers: { Authorization: basic("owner", "wrong") },
    });
    await app.request("/", {
      headers: { Authorization: basic("owner", "wrong") },
    });
    const before = seen.length;

    const blocked = await app.request("/", {
      headers: { Authorization: basic("owner", "wrong") },
    });
    expect(blocked.status).toBe(429);
    // The resolver is where argon2 lives. A flood of wrong passwords must not
    // be able to pin the CPU just by being rejected afterwards.
    expect(seen.length).toBe(before);
    expect(store.consumeCalls).toBe(2);
  });

  it("bars the correct password too once the ceiling is reached", async () => {
    const { app } = throttledApp("s3cret", 1);
    await app.request("/", {
      headers: { Authorization: basic("owner", "wrong") },
    });
    const response = await app.request("/", {
      headers: { Authorization: basic("owner", "s3cret") },
    });
    expect(response.status).toBe(429);
  });

  it("lets OPTIONS through even while barred", async () => {
    const { app } = throttledApp("s3cret", 1);
    await app.request("/", {
      headers: { Authorization: basic("owner", "wrong") },
    });
    const response = await app.request("/", { method: "OPTIONS" });
    expect(response.status).toBe(200);
  });
});

describe("dav secret generation", () => {
  it("produces typeable groups without ambiguous characters", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const secret = generateDavSecret();
      expect(secret).toMatch(/^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
      expect(secret).not.toMatch(/[0o1li]/);
    }
  });

  it("does not repeat", () => {
    const secrets = new Set(
      Array.from({ length: 100 }, () => generateDavSecret()),
    );
    expect(secrets.size).toBe(100);
  });
});
