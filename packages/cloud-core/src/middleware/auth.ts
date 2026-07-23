import type { ApiKeyScope } from "@repo/schemas/cloud";
import { createMiddleware } from "hono/factory";

import type { Project, UserRole } from "../db/schema";
import { AuthenticationError } from "../errors";
import type { SafeUserRecord } from "../services/types";

export interface AuthVariables {
  user: SafeUserRecord;
  sessionId: string | undefined;
  project: Project | undefined;
  scopes: ApiKeyScope[] | undefined;
}

export interface SessionAuthResult {
  user: SafeUserRecord;
  sessionId: string;
}

export interface ApiKeyAuthResult {
  user: SafeUserRecord;
  project: Project;
  scopes: ApiKeyScope[];
}

export interface AuthResolvers {
  resolveSession(headers: Headers): Promise<SessionAuthResult | null>;
  resolveApiKey(key: string): Promise<ApiKeyAuthResult>;
}

function unauthorizedResponse() {
  return {
    error: {
      code: "UNAUTHORIZED",
      message: "Authentication required",
    },
  } as const;
}

function enrollmentRequiredResponse() {
  return {
    error: {
      code: "MFA_ENROLLMENT_REQUIRED",
      message: "Complete two-factor enrollment before continuing",
    },
  } as const;
}

export function auth(resolvers: AuthResolvers) {
  return createMiddleware<{ Variables: AuthVariables }>(
    async (context, next) => {
      try {
        const session = await resolvers.resolveSession(context.req.raw.headers);
        if (session) {
          if (session.user.status !== "active" || !session.user.totpEnabled) {
            return context.json(enrollmentRequiredResponse(), 403);
          }

          context.set("user", session.user);
          context.set("sessionId", session.sessionId);
          context.set("project", undefined);
          context.set("scopes", undefined);
          return next();
        }

        const authorization = context.req.header("Authorization");
        const bearerKey = authorization?.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length).trim()
          : undefined;
        const apiKey = bearerKey || context.req.header("X-API-Key");
        if (!apiKey) {
          return context.json(unauthorizedResponse(), 401);
        }

        const result = await resolvers.resolveApiKey(apiKey);
        if (result.user.status !== "active") {
          return context.json(unauthorizedResponse(), 401);
        }

        context.set("user", result.user);
        context.set("sessionId", undefined);
        context.set("project", result.project);
        context.set("scopes", result.scopes);
        return next();
      } catch (error) {
        if (error instanceof AuthenticationError) {
          return context.json(
            {
              error: {
                code: error.code,
                message: error.message,
              },
            },
            401,
          );
        }
        throw error;
      }
    },
  );
}

export function requireRole(...roles: UserRole[]) {
  return createMiddleware<{ Variables: AuthVariables }>(
    async (context, next) => {
      const user = context.get("user");
      if (!roles.includes(user.role)) {
        return context.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "Insufficient permissions",
            },
          },
          403,
        );
      }

      return next();
    },
  );
}

export function requireScope(...requiredScopes: ApiKeyScope[]) {
  return createMiddleware<{ Variables: AuthVariables }>(
    async (context, next) => {
      const scopes = context.get("scopes");

      // Human sessions have full user access. Scoped API keys always provide
      // an array, including an empty one, so the auth mechanism stays explicit.
      if (scopes === undefined) {
        return next();
      }

      const hasEveryScope = requiredScopes.every((scope) =>
        scopes.includes(scope),
      );
      if (!hasEveryScope) {
        return context.json(
          {
            error: {
              code: "INSUFFICIENT_SCOPE",
              message: `Required scopes: ${requiredScopes.join(", ")}`,
            },
          },
          403,
        );
      }

      return next();
    },
  );
}
