import { z } from "zod";

export const cloudDateTimeSchema = z.iso.datetime({ offset: true });

export const userRoleSchema = z.enum(["superuser", "user"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(["pending", "active"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const safeUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  email: z.email().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  totpEnabled: z.boolean(),
  createdAt: cloudDateTimeSchema,
  updatedAt: cloudDateTimeSchema,
});
export type SafeUser = z.infer<typeof safeUserSchema>;

export const safeSessionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  expiresAt: cloudDateTimeSchema,
  createdAt: cloudDateTimeSchema,
});
export type SafeSession = z.infer<typeof safeSessionSchema>;

export const API_KEY_SCOPES = [
  "storage:read",
  "storage:write",
  "storage:delete",
  "search:read",
  "search:write",
  "search:manage",
] as const;

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const safeApiKeySchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  expiresAt: cloudDateTimeSchema.nullable(),
  lastUsedAt: cloudDateTimeSchema.nullable(),
  createdAt: cloudDateTimeSchema,
});
export type SafeApiKey = z.infer<typeof safeApiKeySchema>;

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
  requiresRecoveryCode: z.boolean().optional(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export function apiResponseSchema<TSchema extends z.ZodType>(
  dataSchema: TSchema,
) {
  return z.object({ data: dataSchema });
}

export type ApiResponse<T> = z.infer<
  ReturnType<typeof apiResponseSchema<z.ZodType<T>>>
>;

export const paginationSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function paginatedResponseSchema<TSchema extends z.ZodType>(
  itemSchema: TSchema,
) {
  return z.object({
    data: z.array(itemSchema),
    pagination: paginationSchema,
  });
}

export type PaginatedResponse<T> = z.infer<
  ReturnType<typeof paginatedResponseSchema<z.ZodType<T>>>
>;
