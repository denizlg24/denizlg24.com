import {
  type ActivityRecorder,
  AuthenticationError,
  type AuthVariables,
  activityCapture,
  CloudCoreError,
  cors,
  type Database,
  deleteUser,
  hashPassword,
  issueSmbCredential,
  listLegacyS3Credentials,
  listSmbCredentials,
  listUsers,
  type PeekableRateLimitStore,
  rateLimit,
  requireRole,
  requireSession,
  resetUserMfa,
  revokeSmbCredential,
  type S3ApiConfig,
  type SmbProvisioner,
  type StorageService,
  s3Routes,
  toSafeUser,
  auth as unifiedAuth,
  users,
  validateApiKey,
} from "@repo/cloud-core";
import { authAccount, authUser } from "@repo/cloud-core/db/schema";
import {
  ACTIVITY_ACTIONS,
  adminResetMfaInputSchema,
  completeSignupInputSchema,
  createPendingUserInputSchema,
  createSmbCredentialInputSchema,
} from "@repo/schemas/cloud";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
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
import type { deployRoutes } from "./deploy/routes";
import type { forgeManagementRoutes } from "./forge/routes";
import type { opsRoutes } from "./ops/routes";
import { type OpsToolsConfig, toolsProxyRoutes } from "./ops/tools-proxy";
import type { projectRoutes } from "./projects/routes";
import { storageRoutes, storageSearchRoutes } from "./storage/routes";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_REQUESTS = 10;
const SIGNUP_MAX_REQUESTS = 5;
// Outside production clientIp() collapses to one key, so the whole machine
// shares a single bucket and a normal debugging session exhausts it. The
// production ceilings are the ones that matter and are left untouched.
const DEV_LOGIN_MAX_REQUESTS = 200;
const DEV_SIGNUP_MAX_REQUESTS = 100;
// Higher than the login ceiling on purpose: a saved password that has been
// revoked makes a mounted drive retry on its own, without a person deciding to,
// so the budget has to absorb one stale client without locking out the machine
// it is running on. Only rejections count against it.
const MFA_ENROLLMENT_PATHS = new Set([
  "/api/auth/get-session",
  "/api/auth/sign-out",
  "/api/auth/two-factor/enable",
  "/api/auth/two-factor/get-totp-uri",
  "/api/auth/two-factor/verify-totp",
]);
// Re-authentication has to stay open: two-factor/enable needs the password,
// which the browser only holds in memory, so any reload during enrollment
// leaves a session that can no longer reach the one endpoint it needs. Signing
// in again replaces that session and is no weaker than a fresh sign-in.
const MFA_ENROLLMENT_PATH_PREFIXES = ["/api/auth/sign-in/"];

function allowedDuringMfaEnrollment(path: string): boolean {
  return (
    MFA_ENROLLMENT_PATHS.has(path) ||
    MFA_ENROLLMENT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}
const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface CloudApiOptions {
  auth: CloudAuth;
  db: Database;
  isProduction: boolean;
  rateLimitStore: PeekableRateLimitStore;
  trustedOrigins: readonly string[];
  storage?: {
    service: StorageService;
    s3: S3ApiConfig;
    /**
     * Provisions Samba accounts on the host. Absent when the host has no SMB
     * boundary, in which case the credential routes answer 503 rather than
     * pretending to issue something that cannot authenticate.
     */
    smbProvisioner?: SmbProvisioner;
  };
  platform?: {
    projects: ReturnType<typeof projectRoutes>;
    postgres: ReturnType<typeof postgresDbAdminRoutes>;
    mongodb: ReturnType<typeof mongoDbAdminRoutes>;
  };
  ops?: ReturnType<typeof opsRoutes>;
  opsTools?: OpsToolsConfig;
  /** Absent when the host has no deploy agent configured. */
  deploy?: ReturnType<typeof deployRoutes>;
  /** Superuser-only Forge host management and telemetry. */
  forge?: ReturnType<typeof forgeManagementRoutes>;
  activity?: {
    recorder: ActivityRecorder;
    slowRequestMs?: number;
  };
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

// Everything under /api/auth is read by two different clients: lib/api.ts
// unwraps `error`, better-auth's client reads a top-level `code`/`message`.
// Emitting one shape leaves the other showing "Sign in failed" for every
// cause, so responses that either may see carry both.
function dualShapeError(code: string, message: string) {
  return { code, message, error: { code, message } } as const;
}

function mfaEnrollmentRequiredError() {
  return dualShapeError(
    "MFA_ENROLLMENT_REQUIRED",
    "Complete two-factor enrollment before continuing",
  );
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
  const guardSuperuser = (prefix: string) => {
    for (const path of [prefix, `${prefix}/*`]) {
      app.use(path, authenticate, requireSession(), requireRole("superuser"));
    }
  };

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

  if (options.activity) {
    const capture = activityCapture({
      record: (entry) => options.activity?.recorder.record(entry),
      slowRequestMs: options.activity.slowRequestMs,
    });
    // Mounted before the per-group `authenticate` middleware so unauthenticated
    // failures are captured too; `context.get("user")` is read after next()
    // resolves, by which point auth has populated it.
    app.use("/api/*", capture);
    // /v2 records failures only (see shouldCapture). Reading `context.res.status`
    // after next() is a plain getter on the finished Response — it does not
    // reassign `res`, so the Bun.file() body and its sendfile() path survive.
    app.use("/v2", capture);
    app.use("/v2/*", capture);
    // better-auth owns the sign-in handler, so a failure is only visible from
    // the outside as a 401. Recording it under its own action is what lets the
    // auth_failure_burst alert count without scanning paths.
    app.use("/api/auth/sign-in/*", async (context, next) => {
      await next();
      if (context.res.status !== 401) return;
      options.activity?.recorder.record({
        category: "auth",
        action: ACTIVITY_ACTIONS.signInFailed,
        severity: "warn",
        actorType: "anonymous",
        method: context.req.method,
        path: context.req.path,
        statusCode: 401,
        ip: clientIp(context, options.isProduction),
        userAgent: context.req.header("User-Agent") ?? null,
      });
    });
  }

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
      !allowedDuringMfaEnrollment(context.req.path)
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
      max: options.isProduction ? LOGIN_MAX_REQUESTS : DEV_LOGIN_MAX_REQUESTS,
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
      max: options.isProduction ? SIGNUP_MAX_REQUESTS : DEV_SIGNUP_MAX_REQUESTS,
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
  app.get("/api/auth/admin/users", async (context) => {
    const { page, limit } = adminUsersQuerySchema.parse({
      page: context.req.query("page"),
      limit: context.req.query("limit"),
    });
    const result = await listUsers(options.db, { page, limit });
    return context.json({
      data: result.users.map(serializeSafeUser),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  });
  app.post("/api/auth/admin/reset-mfa", async (context) => {
    const parsed = adminResetMfaInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: { code: "INVALID_USER_ID", message: "A user id is required" },
        },
        400,
      );
    }
    try {
      await resetUserMfa(options.db, parsed.data.userId);
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
  app.post("/api/auth/two-factor/disable", (context) =>
    context.json(
      dualShapeError(
        "TWO_FACTOR_REQUIRED",
        "Two-factor authentication is mandatory",
      ),
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
    app.get(
      "/api/storage/s3-credentials",
      requireSession(),
      requireRole("superuser"),
      async (context) =>
        context.json({ data: await listLegacyS3Credentials(options.db) }),
    );
    // A device credential grants the whole of a user's storage over SMB, so
    // issuing one takes a human session — a project API key must not be able
    // to mint a credential broader than itself.
    app.get("/api/storage/smb-credentials", requireSession(), async (context) =>
      context.json({
        data: await listSmbCredentials(options.db, context.get("user").id),
      }),
    );
    app.post(
      "/api/storage/smb-credentials",
      requireSession(),
      async (context) => {
        const provisioner = options.storage?.smbProvisioner;
        if (!provisioner) {
          return context.json(
            {
              error: {
                code: "SMB_UNAVAILABLE",
                message: "SMB drives are not enabled on this host",
              },
            },
            503,
          );
        }
        const parsed = createSmbCredentialInputSchema.safeParse(
          await context.req.json().catch(() => null),
        );
        if (!parsed.success) {
          return context.json(
            {
              error: {
                code: "INVALID_INPUT",
                message: "A device name is required",
              },
            },
            400,
          );
        }
        try {
          const issued = await issueSmbCredential(options.db, provisioner, {
            deviceName: parsed.data.deviceName,
            expiresAt: parsed.data.expiresAt
              ? new Date(parsed.data.expiresAt)
              : null,
            userId: context.get("user").id,
          });
          return context.json({ data: issued }, 201);
        } catch (error) {
          // Provisioning reaches a root agent over a socket. A failure there
          // is an operational fault, not a client error, and its message can
          // name host paths — so it is logged, not returned.
          console.error("SMB provisioning failed", error);
          return context.json(
            {
              error: {
                code: "SMB_PROVISION_FAILED",
                message: "Could not issue the device credential",
              },
            },
            502,
          );
        }
      },
    );
    app.delete(
      "/api/storage/smb-credentials/:id",
      requireSession(),
      async (context) => {
        const provisioner = options.storage?.smbProvisioner;
        if (!provisioner) {
          return context.json(
            {
              error: {
                code: "SMB_UNAVAILABLE",
                message: "SMB drives are not enabled on this host",
              },
            },
            503,
          );
        }
        const id = context.req.param("id");
        // The column is a uuid, so anything else reaches Postgres as a cast
        // error and surfaces as a 500 instead of the intended miss.
        if (!z.uuid().safeParse(id).success) {
          return context.json(
            { error: { code: "NOT_FOUND", message: "Credential not found" } },
            404,
          );
        }
        const revoked = await revokeSmbCredential(
          options.db,
          provisioner,
          context.get("user").id,
          id,
        );
        return revoked
          ? context.json({ data: { id } })
          : context.json(
              {
                error: { code: "NOT_FOUND", message: "Credential not found" },
              },
              404,
            );
      },
    );
    app.route("/api/storage", storageRoutes(options.storage.service));
    app.route("/api/search", storageSearchRoutes(options.storage.service));
    app.route("/v2", s3Routes(options.storage.s3));
  }

  if (options.platform) {
    app.use("/api/projects", authenticate);
    app.use("/api/projects/*", authenticate);
    app.route("/api/projects", options.platform.projects);

    guardSuperuser("/api/db");
    app.route("/api/db/postgres", options.platform.postgres);
    app.route("/api/db/mongodb", options.platform.mongodb);
  }

  if (options.ops) {
    guardSuperuser("/api/ops");
    app.route("/api/ops/tools", toolsProxyRoutes(options.opsTools ?? {}));
    app.route("/api/ops", options.ops);
  }

  if (options.deploy) {
    // The agent presents a bearer token, not a session, and the routes it
    // calls enforce that themselves. Running `authenticate` over them first
    // would reject the agent before it ever reached its own guard. GitHub
    // presents neither — the webhook authenticates by HMAC over the raw body,
    // and nothing here may read that body first.
    app.use("/api/deploy/*", async (context, next) => {
      if (context.req.path.startsWith("/api/deploy/agent/")) return next();
      if (context.req.path.startsWith("/api/deploy/hooks/")) return next();
      return authenticate(context, next);
    });
    app.route("/api/deploy", options.deploy);
  }

  if (options.forge) {
    guardSuperuser("/api/forge");
    app.route("/api/forge", options.forge);
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
