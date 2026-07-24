import type { ApiKeyScope } from "@repo/schemas/cloud";

import type { Project } from "../db/schema";
import type { SafeUserRecord } from "../services/types";
import { isProjectPath, isSharedPath } from "./path";

export interface StoragePrincipal {
  user: SafeUserRecord;
  project?: Project;
  scopes?: ApiKeyScope[];
}

export type StorageAccessResult =
  | { allowed: true }
  | {
      allowed: false;
      code: "ACCESS_DENIED" | "INSUFFICIENT_SCOPE";
      message: string;
    };

export function checkStorageAccess(
  principal: StoragePrincipal,
  resourcePath: string,
  scope: Extract<
    ApiKeyScope,
    "storage:read" | "storage:write" | "storage:delete"
  >,
  ownerId: string | null,
  mode: "read" | "modify",
): StorageAccessResult {
  if (principal.project) {
    if (!principal.scopes?.includes(scope)) {
      return {
        allowed: false,
        code: "INSUFFICIENT_SCOPE",
        message: `Required scope: ${scope}`,
      };
    }
    if (!isProjectPath(resourcePath, principal.project.slug)) {
      return {
        allowed: false,
        code: "ACCESS_DENIED",
        message: "Resource is outside project scope",
      };
    }
    return { allowed: true };
  }

  if (mode === "read" && isSharedPath(resourcePath)) {
    return { allowed: true };
  }
  if (ownerId === principal.user.id || principal.user.role === "superuser") {
    return { allowed: true };
  }
  return {
    allowed: false,
    code: "ACCESS_DENIED",
    message: "You do not have access to this resource",
  };
}
