import {
  AuthenticationError,
  type AuthVariables,
  CloudCoreError,
  type Database,
  deleteUser,
  hashPassword,
  type RateLimitStore,
  rateLimit,
  requireRole,
  requireSession,
  type S3ApiConfig,
  type StorageService,
  s3Routes,
  toSafeUser,
  auth as unifiedAuth,
  users,
  validateApiKey,
} from "@repo/cloud-core";
import { authAccount, authUser } from "@repo/cloud-core/db/schema";
import {
  completeSignupInputSchema,
  createPendingUserInputSchema,
} from "@repo/schemas/cloud";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import pkg from "../package.json";
import type { CloudAuth } from "./auth/better-auth";
import {
  completePendingSignup,
  createPendingAuthUser,
  SignupCompletionError,
  serializeSafeUser,
} from "./auth/users";
import type {
  mongoDbAdminRoutes,
  postgresDbAdminRoutes,
} from "./db-admin/routes";
import type { opsRoutes } from "./ops/routes";
import type { projectRoutes } from "./projects/routes";
import { storageRoutes, storageSearchRoutes } from "./storage/routes";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_REQUESTS = 10;
const SIGNUP_MAX_REQUESTS = 5;
const MFA_ENROLLMENT_PATHS = new Set([
  "/api/auth/get-session",
  "/api/auth/sign-out",
  "/api/auth/two-factor/enable",
  "/api/auth/two-factor/get-totp-uri",
  "/api/auth/two-factor/verify-totp",
]);

export interface CloudApiOptions {
  auth: CloudAuth;
  db: Database;
  isProduction: boolean;
  rateLimitStore: RateLimitStore;
  trustedOrigins: readonly string[];
  storage?: {
    service: StorageService;
    s3: S3ApiConfig;
  };
  platform?: {
    projects: ReturnType<typeof projectRoutes>;
    postgres: ReturnType<typeof postgresDbAdminRoutes>;
    mongodb: ReturnType<typeof mongoDbAdminRoutes>;
  };
  ops?: ReturnType<typeof opsRoutes>;
}

function clientIp(
  context: {
    req: { header(name: string): string | undefined };
  },
  isProduction: boolean,
): string {
  const cloudflareIp = context.req.header("CF-Connecting-IP")?.trim();
  if (cloudflareIp) {
    return cloudflareIp;
  }
  if (isProduction) {
    return "missing-cloudflare-client-ip";
  }
  return context.req.header("X-Real-IP")?.trim() || "local-development";
}

function copySetCookieHeaders(from: Headers, to: Headers): void {
  for (const cookie of from.getSetCookie()) {
    to.append("Set-Cookie", cookie);
  }
}

function genericSignupError() {
  return {
    error: {
      code: "SIGNUP_FAILED",
      message: "Unable to complete signup",
    },
  } as const;
}

function mfaEnrollmentRequiredError() {
  return {
    error: {
      code: "MFA_ENROLLMENT_REQUIRED",
      message: "Complete two-factor enrollment before continuing",
    },
  } as const;
}

export function createCloudApiApp(options: CloudApiOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const trustedOrigins = new Set(options.trustedOrigins);
  const authenticate = unifiedAuth({
    resolveApiKey: async (key) => {
      const result = await validateApiKey(options.db, key);
      const owner = await options.db.query.authUser.findFirst({
        columns: { banned: true },
        where: eq(authUser.id, result.user.id),
      });
      if (!owner || owner.banned) {
        throw new AuthenticationError("Invalid API key", "INVALID_API_KEY");
      }
      return result;
    },
    resolveSession: async (headers) => {
      const session = await options.auth.api.getSession({ headers });
      if (!session) {
        return null;
      }
      const legacyUser = await options.db.query.users.findFirst({
        where: eq(users.id, session.user.id),
      });
      if (!legacyUser) {
        return null;
      }
      const sessionStatus =
        session.user.status === "active" ? "active" : "pending";
      return {
        sessionId: session.session.id,
        user: {
          ...toSafeUser(legacyUser),
          status: sessionStatus,
          totpEnabled: session.user.twoFactorEnabled === true,
        },
      };
    },
  });

  app.use(
    "/api/*",
    cors({
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "Tus-Resumable",
        "Upload-Length",
        "Upload-Metadata",
        "Upload-Offset",
      ],
      allowMethods: [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ],
      credentials: true,
      exposeHeaders: [
        "Location",
        "Tus-Resumable",
        "Tus-Version",
        "Tus-Extension",
        "Upload-Length",
        "Upload-Offset",
      ],
      maxAge: 600,
      origin: (origin) => (trustedOrigins.has(origin) ? origin : undefined),
    }),
  );

  app.get("/", (context) => context.text("Deniz Cloud API"));
  app.get("/healthz", (context) =>
    context.json({
      status: "ok",
      version: process.env.APP_VERSION ?? pkg.version,
    }),
  );

  app.use("/api/auth/*", async (context, next) => {
    const session = await options.auth.api.getSession({
      headers: context.req.raw.headers,
    });
    if (!session) {
      return next();
    }
    const enrollment = await options.db.query.authUser.findFirst({
      columns: { status: true, twoFactorEnabled: true },
      where: eq(authUser.id, session.user.id),
    });
    if (
      enrollment &&
      (enrollment.status !== "active" || !enrollment.twoFactorEnabled) &&
      !MFA_ENROLLMENT_PATHS.has(context.req.path)
    ) {
      return context.json(mfaEnrollmentRequiredError(), 403);
    }
    return next();
  });
  app.use("/api/auth/admin/*", authenticate, requireRole("superuser"));

  app.use(
    "/api/auth/sign-in/*",
    rateLimit({
      keyGenerator: (context) =>
        `login:${clientIp(context, options.isProduction)}`,
      max: LOGIN_MAX_REQUESTS,
      store: options.rateLimitStore,
      windowMs: LOGIN_WINDOW_MS,
    }),
  );
  app.use("/api/auth/sign-in/*", async (context, next) => {
    const parsed = await context.req.raw
      .clone()
      .json()
      .then((body) =>
        completeSignupInputSchema
          .pick({ username: true })
          .partial()
          .safeParse(body),
      )
      .catch(() => null);
    if (parsed?.success && parsed.data.username) {
      const pendingUser = await options.db.query.authUser.findFirst({
        columns: { id: true },
        where: andPendingUsername(parsed.data.username),
      });
      if (pendingUser) {
        return context.json(
          {
            code: "INVALID_USERNAME_OR_PASSWORD",
            message: "Invalid username or password",
          },
          401,
        );
      }
    }
    return next();
  });

  app.use(
    "/api/auth/complete-signup",
    rateLimit({
      keyGenerator: (context) =>
        `complete-signup:${clientIp(context, options.isProduction)}`,
      max: SIGNUP_MAX_REQUESTS,
      store: options.rateLimitStore,
      windowMs: LOGIN_WINDOW_MS,
    }),
  );
  app.post("/api/auth/complete-signup", async (context) => {
    const body = await context.req.json().catch(() => null);
    const parsed = completeSignupInputSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid signup details",
          },
        },
        400,
      );
    }

    try {
      const completed = await completePendingSignup(
        options.db,
        options.auth,
        parsed.data,
      );
      const response = context.json({ data: completed.result });
      copySetCookieHeaders(completed.responseHeaders, response.headers);
      return response;
    } catch (error) {
      if (!(error instanceof SignupCompletionError)) {
        console.error("Pending signup completion failed", error);
      }
      return context.json(genericSignupError(), 400);
    }
  });

  app.post("/api/auth/admin/create-pending-user", async (context) => {
    const body = await context.req.json().catch(() => null);
    const parsed = createPendingUserInputSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid pending user details",
          },
        },
        400,
      );
    }

    try {
      const created = await createPendingAuthUser(
        options.db,
        options.auth,
        parsed.data,
      );
      return context.json({ data: created }, 201);
    } catch (error) {
      console.error("Pending user creation failed", error);
      return context.json(
        {
          error: {
            code: "USER_CREATE_FAILED",
            message: "Unable to create pending user",
          },
        },
        409,
      );
    }
  });

  app.post("/api/auth/admin/create-user", (context) =>
    context.json(
      {
        error: {
          code: "PENDING_SIGNUP_REQUIRED",
          message: "Create users through the pending-signup flow",
        },
      },
      405,
    ),
  );
  app.post("/api/auth/admin/remove-user", async (context) => {
    const body: object | null = await context.req.json().catch(() => null);
    if (
      body === null ||
      !("userId" in body) ||
      typeof body.userId !== "string"
    ) {
      return context.json(
        {
          error: { code: "INVALID_USER_ID", message: "A user id is required" },
        },
        400,
      );
    }
    try {
      await deleteUser(options.db, body.userId);
      return context.json({ success: true });
    } catch (error) {
      if (error instanceof CloudCoreError) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      throw error;
    }
  });
  app.post("/api/auth/admin/set-user-password", async (context) => {
    const body: object | null = await context.req.json().catch(() => null);
    if (
      body === null ||
      !("userId" in body) ||
      typeof body.userId !== "string" ||
      !("newPassword" in body) ||
      typeof body.newPassword !== "string" ||
      body.newPassword.length < 8 ||
      body.newPassword.length > 128
    ) {
      return context.json(
        { error: { code: "INVALID_PASSWORD", message: "Invalid password" } },
        400,
      );
    }
    const userId = body.userId;
    const password = await hashPassword(body.newPassword);
    const updated = await options.db.transaction(async (tx) => {
      const accounts = await tx
        .update(authAccount)
        .set({ password, updatedAt: new Date() })
        .where(
          and(
            eq(authAccount.userId, userId),
            eq(authAccount.providerId, "credential"),
          ),
        )
        .returning({ id: authAccount.id });
      if (accounts.length === 0) {
        return false;
      }
      await tx
        .update(users)
        .set({ passwordHash: password, updatedAt: new Date() })
        .where(eq(users.id, userId));
      return true;
    });
    if (!updated) {
      return context.json(
        { error: { code: "USER_NOT_FOUND", message: "User not found" } },
        404,
      );
    }
    return context.json({ success: true });
  });
  app.post("/api/auth/two-factor/disable", (context) =>
    context.json(
      {
        error: {
          code: "TWO_FACTOR_REQUIRED",
          message: "Two-factor authentication is mandatory",
        },
      },
      403,
    ),
  );

  app.get("/api/me", authenticate, (context) =>
    context.json({ data: serializeSafeUser(context.get("user")) }),
  );

  if (options.storage) {
    app.use("/api/storage/*", async (context, next) => {
      if (
        context.req.method === "OPTIONS" ||
        context.req.path.startsWith("/api/storage/share/")
      ) {
        return next();
      }
      return authenticate(context, next);
    });
    app.use("/api/search", authenticate);
    app.use("/api/search/*", authenticate);
    app.route("/api/storage", storageRoutes(options.storage.service));
    app.route("/api/search", storageSearchRoutes(options.storage.service));
    app.route("/v2", s3Routes(options.storage.s3));
  }

  if (options.platform) {
    app.use("/api/projects", authenticate);
    app.use("/api/projects/*", authenticate);
    app.route("/api/projects", options.platform.projects);

    app.use(
      "/api/db",
      authenticate,
      requireSession(),
      requireRole("superuser"),
    );
    app.use(
      "/api/db/*",
      authenticate,
      requireSession(),
      requireRole("superuser"),
    );
    app.route("/api/db/postgres", options.platform.postgres);
    app.route("/api/db/mongodb", options.platform.mongodb);
  }

  if (options.ops) {
    app.use(
      "/api/ops",
      authenticate,
      requireSession(),
      requireRole("superuser"),
    );
    app.use(
      "/api/ops/*",
      authenticate,
      requireSession(),
      requireRole("superuser"),
    );
    app.route("/api/ops", options.ops);
  }

  app.on(["GET", "POST"], "/api/auth/*", (context) =>
    options.auth.handler(context.req.raw),
  );

  app.onError((error, context) => {
    if (error instanceof CloudCoreError) {
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    if (error instanceof z.ZodError) {
      return context.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Invalid request parameter",
          },
        },
        400,
      );
    }
    console.error("Unhandled API error", error);
    return context.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      },
      500,
    );
  });

  return app;
}

function andPendingUsername(username: string) {
  return and(
    eq(authUser.username, username.trim().toLowerCase()),
    eq(authUser.status, "pending"),
  );
}
