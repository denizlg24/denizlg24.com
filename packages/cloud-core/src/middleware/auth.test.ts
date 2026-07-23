import { describe, expect, it } from "bun:test";
import type { ApiKeyScope } from "@repo/schemas/cloud";
import { Hono } from "hono";

import type { Project } from "../db/schema";
import { AuthenticationError } from "../errors";
import type { SafeUserRecord } from "../services/types";
import {
  type AuthResolvers,
  type AuthVariables,
  auth,
  requireRole,
  requireScope,
} from "./auth";

const user: SafeUserRecord = {
  id: "6a2150ee-03ea-4b5a-a67b-102788069cb4",
  username: "user",
  email: null,
  role: "user",
  status: "active",
  totpEnabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const project: Project = {
  id: "c54da19f-2503-4684-a04a-3e395cc4169a",
  name: "Test",
  slug: "test",
  description: null,
  ownerId: user.id,
  storageFolderId: null,
  meiliApiKeyUid: null,
  meiliApiKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createApp(options: {
  role: "user" | "superuser";
  scopes: ApiKeyScope[] | undefined;
  requiredRole?: "user" | "superuser";
  requiredScopes?: ApiKeyScope[];
}) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use(async (context, next) => {
    context.set("user", { ...user, role: options.role });
    context.set(
      "sessionId",
      options.scopes === undefined ? "session-id" : undefined,
    );
    context.set("project", undefined);
    context.set("scopes", options.scopes);
    return next();
  });

  if (options.requiredRole) {
    app.use(requireRole(options.requiredRole));
  }
  if (options.requiredScopes) {
    app.use(requireScope(...options.requiredScopes));
  }

  app.get("/test", (context) => context.json({ ok: true }));
  return app;
}

describe("authorization middleware", () => {
  it("enforces roles", async () => {
    const denied = await createApp({
      role: "user",
      scopes: undefined,
      requiredRole: "superuser",
    }).request("/test");
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Insufficient permissions",
      },
    });

    const allowed = await createApp({
      role: "superuser",
      scopes: undefined,
      requiredRole: "superuser",
    }).request("/test");
    expect(allowed.status).toBe(200);
  });

  it("lets human sessions bypass API key scope checks", async () => {
    const response = await createApp({
      role: "user",
      scopes: undefined,
      requiredScopes: ["storage:read", "storage:write"],
    }).request("/test");

    expect(response.status).toBe(200);
  });

  it("requires every requested API key scope", async () => {
    const denied = await createApp({
      role: "user",
      scopes: ["storage:read"],
      requiredScopes: ["storage:read", "storage:write"],
    }).request("/test");
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: {
        code: "INSUFFICIENT_SCOPE",
        message: "Required scopes: storage:read, storage:write",
      },
    });

    const allowed = await createApp({
      role: "user",
      scopes: ["storage:read", "storage:write"],
      requiredScopes: ["storage:read", "storage:write"],
    }).request("/test");
    expect(allowed.status).toBe(200);
  });
});

function createAuthenticationApp(resolvers: AuthResolvers) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use(auth(resolvers));
  app.get("/test", (context) =>
    context.json({
      projectId: context.get("project")?.id,
      scopes: context.get("scopes"),
      sessionId: context.get("sessionId"),
      userId: context.get("user").id,
    }),
  );
  return app;
}

const noSession = () => Promise.resolve(null);

describe("unified authentication middleware", () => {
  it("resolves a Better Auth session before API-key credentials", async () => {
    const app = createAuthenticationApp({
      resolveSession: () => Promise.resolve({ sessionId: "session-id", user }),
      resolveApiKey: () =>
        Promise.resolve({
          project,
          scopes: ["storage:read"],
          user,
        }),
    });

    const response = await app.request("/test", {
      headers: { Authorization: "Bearer machine-key" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessionId: "session-id",
      userId: user.id,
    });
  });

  it("accepts scoped API keys from Bearer and legacy X-API-Key headers", async () => {
    const seenKeys: string[] = [];
    const app = createAuthenticationApp({
      resolveSession: noSession,
      resolveApiKey: (key) => {
        seenKeys.push(key);
        return Promise.resolve({
          project,
          scopes: ["storage:read"],
          user,
        });
      },
    });

    const bearer = await app.request("/test", {
      headers: { Authorization: "Bearer bearer-key" },
    });
    const legacy = await app.request("/test", {
      headers: { "X-API-Key": "legacy-key" },
    });

    expect(bearer.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(seenKeys).toEqual(["bearer-key", "legacy-key"]);
  });

  it("returns stable errors for missing and invalid credentials", async () => {
    const app = createAuthenticationApp({
      resolveSession: noSession,
      resolveApiKey: () =>
        Promise.reject(
          new AuthenticationError("Invalid API key", "INVALID_API_KEY"),
        ),
    });

    const missing = await app.request("/test");
    const invalid = await app.request("/test", {
      headers: { Authorization: "Bearer invalid" },
    });

    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
      },
    });
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({
      error: {
        code: "INVALID_API_KEY",
        message: "Invalid API key",
      },
    });
  });

  it("limits pending human sessions to MFA enrollment endpoints", async () => {
    const app = createAuthenticationApp({
      resolveSession: () =>
        Promise.resolve({
          sessionId: "enrollment-session",
          user: { ...user, status: "pending", totpEnabled: false },
        }),
      resolveApiKey: () =>
        Promise.resolve({
          project,
          scopes: [],
          user,
        }),
    });

    const response = await app.request("/test");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "MFA_ENROLLMENT_REQUIRED",
        message: "Complete two-factor enrollment before continuing",
      },
    });
  });
});
