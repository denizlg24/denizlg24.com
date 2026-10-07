import { timingSafeEqual } from "node:crypto";
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
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
  listAllSmbCredentials,
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
  type SmbSessionsReader,
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
  type PublicSignUpResult,
  publicSignUpInputSchema,
} from "@repo/schemas/cloud";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import pkg from "../package.json";
import { accountRoutes } from "./auth/account";
import {
  type CloudAuth,
  isActiveSuperuser,
  isCloudAuthTrustedOrigin,
} from "./auth/better-auth";
import { type AuthMailer, AuthMailUnavailableError } from "./auth/email";
import { type IdentityVariables, requireIdentity } from "./auth/identity";
import { createOAuthBearerResolver } from "./auth/oauth-bearer";
import { oauthClientRoutes } from "./auth/oauth-clients";
import { publicSignUp, SignUpRefusedError } from "./auth/public-signup";
import { withOAuthRequestState } from "./auth/remember-me";
import {
  clientTenancy,
  type TenantAccessDenial,
  tenantAccess,
} from "./auth/tenancy";
import { publicTenantRoutes, tenantRoutes } from "./auth/tenants";
import {
  revokeTrustedDevices,
  summarizeTrustedDevices,
} from "./auth/trusted-devices";
import { TURNSTILE_HEADER, type TurnstileVerifier } from "./auth/turnstile";
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
import { authorizePreviewRequest } from "./forge/preview-auth";
import type { forgeManagementRoutes } from "./forge/routes";
import type { opsRoutes } from "./ops/routes";
import type { statusMonitoringRoutes } from "./ops/status-monitoring";
import { type OpsToolsConfig, toolsProxyRoutes } from "./ops/tools-proxy";
import type { projectRoutes } from "./projects/routes";
import { storageRoutes, storageSearchRoutes } from "./storage/routes";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_REQUESTS = 10;
// A passkey challenge is minted on every login page load for the username
// field's autofill, so it cannot share the login budget: a handful of reloads
// would lock the password form. It writes a verification row, so it is not
// unbounded either.
const PASSKEY_CHALLENGE_MAX_REQUESTS = 60;
const SIGNUP_MAX_REQUESTS = 5;
const PREVIEW_AUTH_WINDOW_MS = 60 * 1_000;
const PREVIEW_AUTH_MAX_REQUESTS = 1_200;
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
// Everything that turns an anonymous request into a session. A passkey
// assertion is a credential guess like a password is, so it shares the login
// budget and the failure recorder.
const SIGN_IN_PATHS = [
  "/api/auth/sign-in/*",
  "/api/auth/passkey/verify-authentication",
];
const PASSKEY_CHALLENGE_PATH =
  "/api/auth/passkey/generate-authenticate-options";

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
  /**
   * Accept access tokens from this API's own authorization server, issued for
   * `audience`, as superuser sessions. Absent in tests that exercise only
   * cookie and API-key auth.
   */
  oauth?: {
    issuer: string;
    audience: string;
    /**
     * Where a browser refused at `/oauth2/authorize` is sent to be told why.
     * Absent, the refusal is the JSON body every other caller gets.
     */
    authAppUrl?: string;
  };
  isProduction: boolean;
  rateLimitStore: PeekableRateLimitStore;
  trustedOrigins: readonly string[];
  /**
   * Self-service accounts for tenant apps. Absent, the sign-up route answers
   * 404 and password reset stays reachable only through Better Auth's own
   * checks (which mail nobody without a mailer).
   */
  publicAccounts?: {
    mailer: AuthMailer;
    turnstile: TurnstileVerifier;
    authAppUrl: string;
    apiUrl: string;
  };
  storage?: {
    service: StorageService;
    s3: S3ApiConfig;
    /**
     * Provisions Samba accounts on the host. Absent when the host has no SMB
     * boundary, in which case the credential routes answer 503 rather than
     * pretending to issue something that cannot authenticate.
     */
    smbProvisioner?: SmbProvisioner;
    /**
     * The host's record of SMB sign-ins, for `last_authenticated_at`. Absent
     * with the provisioner; a failure reads as "nothing new observed".
     */
    smbSessions?: SmbSessionsReader;
  };
  platform?: {
    projects: ReturnType<typeof projectRoutes>;
    postgres: ReturnType<typeof postgresDbAdminRoutes>;
    mongodb: ReturnType<typeof mongoDbAdminRoutes>;
  };
  ops?: ReturnType<typeof opsRoutes>;
  statusMonitoring?: ReturnType<typeof statusMonitoringRoutes>;
  deepHealth?: {
    token: string;
    check: () => Promise<{
      status: "ok" | "degraded" | "down";
      timestamp: string;
      checks: Record<string, unknown>;
    }>;
    rebuildSearch: () => Promise<number>;
  };
  opsTools?: OpsToolsConfig;
  /** Absent when the host has no deploy agent configured. */
  deploy?: ReturnType<typeof deployRoutes>;
  /** Superuser-only Forge host management and telemetry. */
  forge?: ReturnType<typeof forgeManagementRoutes>;
  /** Caddy's public forward-auth check for preview deployment hostnames. */
  previewAccess?: {
    loginUrl: string;
    secret: string;
  };
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

const registrationBodySchema = z
  .object({
    application_type: z.string().optional(),
    redirect_uris: z.array(z.string()).min(1),
  })
  .loose();

function isLoopbackHttp(uri: string): boolean {
  try {
    const url = new URL(uri);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function nativeLoopbackRegistration(
  body: unknown,
): Record<string, unknown> | null {
  const parsed = registrationBodySchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.application_type !== undefined ||
    !parsed.data.redirect_uris.every(isLoopbackHttp)
  ) {
    return null;
  }
  return { ...parsed.data, application_type: "native" };
}

/** The client an authorize, consent or continue request is about. */
async function oauthRequestClientId(request: Request): Promise<string | null> {
  if (request.method !== "POST") {
    return new URL(request.url).searchParams.get("client_id");
  }
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  if (
    typeof body !== "object" ||
    body === null ||
    !("oauth_query" in body) ||
    typeof body.oauth_query !== "string"
  ) {
    return null;
  }
  return new URLSearchParams(body.oauth_query).get("client_id");
}

function tenantDenialError(reason: TenantAccessDenial) {
  switch (reason) {
    case "mfa_required":
      return mfaEnrollmentRequiredError();
    case "email_unverified":
      return dualShapeError(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verify your email address before continuing",
      );
    case "blocked":
      return dualShapeError(
        "TENANT_ACCESS_BLOCKED",
        "This account cannot use this app",
      );
    case "account_inactive":
      return dualShapeError("FORBIDDEN", "This account is not active");
    case "tenant_unavailable":
      return dualShapeError("TENANT_UNAVAILABLE", "This app is unavailable");
  }
}

function mfaEnrollmentRequiredError() {
  return dualShapeError(
    "MFA_ENROLLMENT_REQUIRED",
    "Complete two-factor enrollment before continuing",
  );
}

export function createCloudApiApp(options: CloudApiOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const resolveOAuthBearer = options.oauth
    ? createOAuthBearerResolver({
        auth: options.auth,
        db: options.db,
        issuer: options.oauth.issuer,
        audience: options.oauth.audience,
      })
    : null;
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
        return resolveOAuthBearer ? resolveOAuthBearer(headers) : null;
      }
      // A public account is a deniz auth identity, never a cloud user. The
      // missing `users` row already keeps it out; this keeps it out even if
      // one is ever created for it.
      if (session.user.realm !== "cloud") return null;
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
      origin: (origin) =>
        isCloudAuthTrustedOrigin(origin, options.trustedOrigins)
          ? origin
          : undefined,
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
    for (const path of SIGN_IN_PATHS) {
      app.use(path, async (context, next) => {
        await next();
        const status = context.res.status;
        if (status !== 400 && status !== 401) return;

        options.activity?.recorder.record({
          category: "auth",
          action: ACTIVITY_ACTIONS.signInFailed,
          severity: "warn",
          actorType: "anonymous",
          method: context.req.method,
          path: context.req.path,
          statusCode: status,
          ip: clientIp(context, options.isProduction),
          userAgent: context.req.header("User-Agent") ?? null,
        });
      });
    }
  }

  app.get("/", (context) => context.text("Deniz Cloud API"));
  app.get("/healthz", (context) =>
    context.json({
      status: "ok",
      version: process.env.APP_VERSION ?? pkg.version,
    }),
  );
  if (options.statusMonitoring)
    app.route("/healthz/status", options.statusMonitoring);
  app.get("/healthz/deep", async (context) => {
    const configured = options.deepHealth;
    const supplied = context.req.header("X-DR-Synthetic-Token") ?? "";
    const allowed =
      configured !== undefined &&
      supplied.length === configured.token.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(configured.token));
    if (!allowed || !configured) return context.notFound();
    const result = await configured.check();
    // Degraded is served as 200: the uptime monitor on this endpoint must not
    // report an outage for a dependency that is slow but still serving. The
    // body carries the per-check detail either way.
    return context.json(result, result.status === "down" ? 503 : 200);
  });
  app.post("/healthz/recovery/rebuild-search", async (context) => {
    const configured = options.deepHealth;
    const supplied = context.req.header("X-DR-Synthetic-Token") ?? "";
    const allowed =
      configured !== undefined &&
      supplied.length === configured.token.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(configured.token));
    if (!allowed || !configured) return context.notFound();
    return context.json({ indexed: await configured.rebuildSearch() });
  });

  const previewAccess = options.previewAccess;
  if (previewAccess) {
    app.use(
      "/api/forge-preview-auth",
      rateLimit({
        keyGenerator: (context) =>
          `preview-auth:${clientIp(context, options.isProduction)}`,
        max: PREVIEW_AUTH_MAX_REQUESTS,
        store: options.rateLimitStore,
        windowMs: PREVIEW_AUTH_WINDOW_MS,
      }),
    );
    app.get("/api/forge-preview-auth", (context) =>
      authorizePreviewRequest(context.req.raw, {
        auth: options.auth,
        db: options.db,
        loginUrl: previewAccess.loginUrl,
        secret: previewAccess.secret,
      }),
    );
  }

  app.use("/api/auth/*", async (context, next) => {
    const session = await options.auth.api.getSession({
      headers: context.req.raw.headers,
    });
    if (!session) {
      return next();
    }
    const enrollment = await options.db.query.authUser.findFirst({
      columns: { realm: true, status: true, twoFactorEnabled: true },
      where: eq(authUser.id, session.user.id),
    });
    // Two factors are mandatory for the cloud's own accounts. A public
    // account's second factor is each tenant's policy, enforced when it
    // authorizes that tenant's app.
    if (
      enrollment?.realm === "cloud" &&
      (enrollment.status !== "active" || !enrollment.twoFactorEnabled) &&
      !allowedDuringMfaEnrollment(context.req.path)
    ) {
      return context.json(mfaEnrollmentRequiredError(), 403);
    }
    return next();
  });
  app.use("/api/auth/admin/*", authenticate, requireRole("superuser"));

  // `/oauth2/authorize` is a top-level navigation: a JSON body would be the
  // page. The auth app gets the refusal's code and the original request, so
  // it can say what is missing and resume once it is fixed. Consent and
  // continue are fetches from the auth app and keep the JSON.
  const refuseAuthorization = (
    request: Request,
    error: ReturnType<typeof dualShapeError>,
  ): Response => {
    const authAppUrl = options.oauth?.authAppUrl;
    if (request.method !== "GET" || !authAppUrl) {
      return Response.json(error, { status: 403 });
    }
    const target = new URL("/login", authAppUrl);
    for (const [key, value] of new URL(request.url).searchParams) {
      target.searchParams.append(key, value);
    }
    target.searchParams.set("reason", error.code);
    return new Response(null, {
      status: 302,
      headers: { Location: target.toString(), "Cache-Control": "no-store" },
    });
  };

  // Left alone, the authorization server mints a code for any signed-in
  // account. A first-party client is the owner's alone; a tenant's client is
  // open to whoever that tenant admits. Issuance applies the same rules, and
  // stopping a refused account here keeps a consent row or a code from ever
  // existing for it.
  for (const path of [
    "/api/auth/oauth2/authorize",
    "/api/auth/oauth2/consent",
    "/api/auth/oauth2/continue",
  ]) {
    app.use(path, async (context, next) => {
      const session = await options.auth.api.getSession({
        headers: context.req.raw.headers,
      });
      if (!session) return next();
      const clientId = await oauthRequestClientId(context.req.raw);
      const tenancy = clientId
        ? await clientTenancy(options.db, clientId)
        : null;
      if (tenancy?.tenantId) {
        const access = await tenantAccess(
          options.db,
          tenancy.tenantId,
          session.user.id,
        );
        if (access.ok) return next();
        return refuseAuthorization(
          context.req.raw,
          tenantDenialError(access.reason),
        );
      }
      if (!(await isActiveSuperuser(options.db, session.user.id))) {
        return refuseAuthorization(
          context.req.raw,
          dualShapeError("FORBIDDEN", "Superuser required"),
        );
      }
      return next();
    });
  }

  // Discovery documents are public and read by clients that live on other
  // origins (the MCP inspector runs in a browser), and the plugin marks them
  // server-only, so the auth handler never serves them itself.
  const discovery = (
    handler: (request: Request) => Promise<Response>,
  ): ((context: { req: { raw: Request } }) => Promise<Response>) => {
    return async (context) => {
      const response = await handler(context.req.raw);
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(response.body, {
        headers,
        status: response.status,
      });
    };
  };
  const authServerMetadata = discovery(
    oauthProviderAuthServerMetadata(options.auth),
  );
  const openIdMetadata = discovery(
    oauthProviderOpenIdConfigMetadata(options.auth),
  );
  app.get(
    "/.well-known/oauth-authorization-server/api/auth",
    authServerMetadata,
  );
  app.get(
    "/api/auth/.well-known/oauth-authorization-server",
    authServerMetadata,
  );
  app.get("/.well-known/openid-configuration/api/auth", openIdMetadata);
  app.get("/api/auth/.well-known/openid-configuration", openIdMetadata);

  // Registration defaults `application_type` to "web", which refuses loopback
  // redirects — and native MCP clients (Claude Code, desktop apps) register
  // with http://localhost callbacks without naming a type. A registration
  // whose every redirect is plain-http loopback is a native app by RFC 8252,
  // so it is declared as one; anything else reaches the plugin untouched.
  app.post("/api/auth/oauth2/register", async (context) => {
    const raw = context.req.raw;
    const body: unknown = await raw
      .clone()
      .json()
      .catch(() => null);
    // Tenancy is read from client metadata, which only our own client routes
    // may write. The plugin does not accept it here today; this keeps that
    // true if it ever starts to.
    if (
      typeof body === "object" &&
      body !== null &&
      ("metadata" in body || "reference_id" in body)
    ) {
      return context.json(
        {
          error: "invalid_client_metadata",
          error_description: "metadata cannot be set during registration",
        },
        400,
      );
    }
    const registration = nativeLoopbackRegistration(body);
    if (!registration) return options.auth.handler(raw);
    const headers = new Headers(raw.headers);
    headers.delete("content-length");
    return options.auth.handler(
      new Request(raw.url, {
        body: JSON.stringify(registration),
        headers,
        method: "POST",
      }),
    );
  });

  guardSuperuser("/api/oauth");
  app.route(
    "/api/oauth",
    oauthClientRoutes({ auth: options.auth, db: options.db }),
  );
  // Every deniz account, cloud or public: the tenants it manages and the apps
  // it has let in. Cookie sessions only — `authenticate` would refuse public
  // accounts, which is exactly who most of this is for.
  app.route(
    "/api/tenants",
    tenantRoutes({
      auth: options.auth,
      db: options.db,
      trustedOrigins: options.trustedOrigins,
    }),
  );
  app.route(
    "/api/account",
    accountRoutes({
      auth: options.auth,
      db: options.db,
      trustedOrigins: options.trustedOrigins,
    }),
  );
  app.route(
    "/api/public/tenants",
    publicTenantRoutes({ auth: options.auth, db: options.db }),
  );

  const loginRateLimit = rateLimit({
    keyGenerator: (context) =>
      `login:${clientIp(context, options.isProduction)}`,
    max: options.isProduction ? LOGIN_MAX_REQUESTS : DEV_LOGIN_MAX_REQUESTS,
    store: options.rateLimitStore,
    windowMs: LOGIN_WINDOW_MS,
  });
  for (const path of SIGN_IN_PATHS) app.use(path, loginRateLimit);
  app.use(
    PASSKEY_CHALLENGE_PATH,
    rateLimit({
      keyGenerator: (context) =>
        `passkey-challenge:${clientIp(context, options.isProduction)}`,
      max: options.isProduction
        ? PASSKEY_CHALLENGE_MAX_REQUESTS
        : DEV_LOGIN_MAX_REQUESTS,
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

  // Self-service sign-up, password reset and verification resends all mail
  // someone, so each is held to the sign-up ceiling and a Turnstile check.
  const publicAccounts = options.publicAccounts;
  for (const path of [
    "/api/auth/public/sign-up",
    "/api/auth/request-password-reset",
    "/api/auth/send-verification-email",
  ]) {
    app.use(
      path,
      rateLimit({
        keyGenerator: (context) =>
          `public-account:${clientIp(context, options.isProduction)}`,
        max: options.isProduction
          ? SIGNUP_MAX_REQUESTS
          : DEV_SIGNUP_MAX_REQUESTS,
        store: options.rateLimitStore,
        windowMs: LOGIN_WINDOW_MS,
      }),
    );
    app.use(path, async (context, next) => {
      // Unconfigured, nothing that mails a public account exists at all.
      if (!publicAccounts) return context.notFound();
      const human = await publicAccounts.turnstile(
        context.req.header(TURNSTILE_HEADER),
        options.isProduction ? clientIp(context, true) : null,
      );
      if (!human) {
        return context.json(
          dualShapeError("CHALLENGE_FAILED", "Please try again"),
          403,
        );
      }
      return next();
    });
  }
  app.post("/api/auth/public/sign-up", async (context) => {
    if (!publicAccounts) return context.notFound();
    const parsed = publicSignUpInputSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        dualShapeError("INVALID_INPUT", "Check the details and try again"),
        400,
      );
    }
    try {
      await publicSignUp(
        {
          auth: options.auth,
          db: options.db,
          mailer: publicAccounts.mailer,
          authAppUrl: publicAccounts.authAppUrl,
          apiUrl: publicAccounts.apiUrl,
        },
        parsed.data,
      );
    } catch (error) {
      if (error instanceof SignUpRefusedError) {
        return context.json(
          dualShapeError(
            error.code,
            error.code === "INVALID_CALLBACK"
              ? "Invalid return address"
              : "This app is not accepting new accounts",
          ),
          error.code === "INVALID_CALLBACK" ? 400 : 403,
        );
      }
      if (error instanceof AuthMailUnavailableError) {
        console.error("Public sign-up could not send mail", error);
        return context.json(
          dualShapeError(
            "MAIL_UNAVAILABLE",
            "We couldn't send the email. Try again in a few minutes.",
          ),
          503,
        );
      }
      throw error;
    }
    const result: PublicSignUpResult = { verificationSent: true };
    return context.json({ data: result }, 202);
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
  // The twoFactor plugin issues device trust but never lists or revokes it.
  // Revoking only ever narrows access, so any session may do it.
  // Every account, cloud or public, owns its device trust.
  const trustedDevices = new Hono<{ Variables: IdentityVariables }>();
  trustedDevices.use(
    "*",
    requireIdentity({
      auth: options.auth,
      db: options.db,
      trustedOrigins: options.trustedOrigins,
    }),
  );
  trustedDevices.get("/", async (context) =>
    context.json({
      data: await summarizeTrustedDevices(
        options.db,
        context.get("identity").userId,
      ),
    }),
  );
  trustedDevices.post("/revoke", async (context) =>
    context.json({
      data: await revokeTrustedDevices(
        options.db,
        context.get("identity").userId,
      ),
    }),
  );
  app.route("/api/auth/trusted-devices", trustedDevices);

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
    app.get(
      "/api/storage/smb-credentials",
      requireSession(),
      async (context) => {
        const user = context.get("user");
        if (context.req.query("owner") === "all") {
          if (user.role !== "superuser") {
            return context.json(
              {
                error: {
                  code: "FORBIDDEN",
                  message: "Only a superuser can list everyone's devices",
                },
              },
              403,
            );
          }
          return context.json({
            data: await listAllSmbCredentials(
              options.db,
              options.storage?.smbSessions,
            ),
          });
        }
        return context.json({
          data: await listSmbCredentials(
            options.db,
            user.id,
            options.storage?.smbSessions,
          ),
        });
      },
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
            platform: parsed.data.platform ?? null,
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
    app.route(
      "/api/storage",
      storageRoutes(options.storage.service, {
        isProduction: options.isProduction,
        rateLimitStore: options.rateLimitStore,
      }),
    );
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
    withOAuthRequestState(context.req.raw, () =>
      options.auth.handler(context.req.raw),
    ),
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
