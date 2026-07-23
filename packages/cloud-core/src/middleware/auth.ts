import type { ApiKeyScope } from "@repo/schemas/cloud";
import { createMiddleware } from "hono/factory";

import type { Project, UserRole } from "../db/schema";
import type { SafeUserRecord } from "../services/types";

export interface AuthVariables {
  user: SafeUserRecord;
  sessionId: string | undefined;
  project: Project | undefined;
  scopes: ApiKeyScope[] | undefined;
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
