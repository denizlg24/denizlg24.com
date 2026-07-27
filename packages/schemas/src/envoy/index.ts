import { z } from "zod";

export const envoyUuidSchema = z.uuid();
export const envoyHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 hash");

export const envoyErrorResponseSchema = z.object({
  error: z.string(),
});
export type EnvoyErrorResponse = z.infer<typeof envoyErrorResponseSchema>;

export const envoyProjectParamsSchema = z.object({
  projectId: envoyUuidSchema,
});

export const envoyProjectMemberParamsSchema = envoyProjectParamsSchema.extend({
  userId: envoyUuidSchema,
});

export const envoyBlobParamsSchema = envoyProjectParamsSchema.extend({
  hash: envoyHashSchema,
});

export const envoyBlobTypeSchema = z.enum(["blob", "manifest", "commit"]);
export type EnvoyBlobType = z.infer<typeof envoyBlobTypeSchema>;

export const envoySignedUrlResponseSchema = z.object({
  method: z.enum(["PUT", "GET"]),
  url: z.url(),
});
export type EnvoySignedUrlResponse = z.infer<
  typeof envoySignedUrlResponseSchema
>;

export const envoyBlobAccessInputSchema = z.object({
  memberIds: z.array(envoyUuidSchema).max(500).nullable(),
});
export type EnvoyBlobAccessInput = z.infer<typeof envoyBlobAccessInputSchema>;

export const envoyBlobAccessResponseSchema = z.object({
  projectId: envoyUuidSchema,
  blobHash: envoyHashSchema,
  grants: z.array(z.object({ userId: envoyUuidSchema })),
});
export type EnvoyBlobAccessResponse = z.infer<
  typeof envoyBlobAccessResponseSchema
>;

export const envoyCreateProjectResponseSchema = z.object({
  projectId: envoyUuidSchema,
});
export type EnvoyCreateProjectResponse = z.infer<
  typeof envoyCreateProjectResponseSchema
>;

export const envoyHeadResponseSchema = z.object({
  head: envoyHashSchema.nullable(),
});
export type EnvoyHeadResponse = z.infer<typeof envoyHeadResponseSchema>;

export const envoyUpdateHeadInputSchema = z.object({
  new_head: envoyHashSchema,
  expected_head: envoyHashSchema.nullable().optional(),
});
export type EnvoyUpdateHeadInput = z.infer<typeof envoyUpdateHeadInputSchema>;

export const envoyAddMemberInputSchema = z.object({
  githubId: z.string().regex(/^\d+$/, "Expected a numeric GitHub user ID"),
  nickname: z.string().trim().min(1).max(100).optional(),
});
export type EnvoyAddMemberInput = z.infer<typeof envoyAddMemberInputSchema>;

export const envoyProjectMemberSchema = z.object({
  userId: envoyUuidSchema,
  projectId: envoyUuidSchema,
  role: z.enum(["owner", "user"]),
  nickname: z.string().nullable(),
});
export type EnvoyProjectMember = z.infer<typeof envoyProjectMemberSchema>;

export const envoyProjectMemberWithUserSchema = envoyProjectMemberSchema.extend(
  {
    user: z.object({
      id: envoyUuidSchema,
      email: z.email().nullable(),
      githubId: z.string(),
      createdAt: z.iso.datetime(),
    }),
  },
);

export const envoyProjectMemberResponseSchema = z.object({
  projectMember: envoyProjectMemberSchema,
});

export const envoyProjectMembersResponseSchema = z.object({
  members: z.array(envoyProjectMemberWithUserSchema),
});

export const envoyRemoveMemberResponseSchema = z.object({
  success: z.literal(true),
  deletedMember: envoyProjectMemberSchema,
});

export const envoyRemoveAllMembersResponseSchema = z.object({
  success: z.literal(true),
  deletedCount: z.number().int().nonnegative(),
});

export const envoyGithubDeviceCodeSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.url(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
});
export type EnvoyGithubDeviceCode = z.infer<typeof envoyGithubDeviceCodeSchema>;

export const envoyGithubAccessTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("bearer"),
  scope: z.string(),
});

export const envoyGithubAccessTokenPendingSchema = z.object({
  error: z.enum([
    "authorization_pending",
    "slow_down",
    "expired_token",
    "access_denied",
  ]),
  error_description: z.string().optional(),
});

export const envoyGithubTokenResponseSchema = z.union([
  envoyGithubAccessTokenSchema,
  envoyGithubAccessTokenPendingSchema,
]);

export const envoyGithubTokenInputSchema = z.object({
  device_code: z.string().min(1).max(256),
});

export const envoyGithubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  email: z.email().nullable(),
});

export const envoyAuthTokenResponseSchema = z.union([
  envoyGithubAccessTokenPendingSchema,
  z.object({ apiToken: z.string().min(1) }),
]);

export const envoyServiceHealthSchema = z.object({
  healthy: z.boolean(),
  responseTime: z.number().int().nonnegative().nullable(),
  error: z.string().optional(),
});
export type EnvoyServiceHealth = z.infer<typeof envoyServiceHealthSchema>;

export const envoyHealthCheckResultSchema = z.object({
  healthy: z.boolean(),
  responseTime: z.number().int().nonnegative(),
  services: z.object({
    database: envoyServiceHealthSchema,
    storage: envoyServiceHealthSchema,
    github: envoyServiceHealthSchema,
  }),
});
export type EnvoyHealthCheckResult = z.infer<
  typeof envoyHealthCheckResultSchema
>;

export const envoyDayStatusSchema = z.enum([
  "operational",
  "degraded",
  "down",
  "no-data",
]);
export type EnvoyDayStatus = z.infer<typeof envoyDayStatusSchema>;

export const envoyStatusStatsSchema = z.object({
  currentStatus: z
    .object({
      healthy: z.boolean(),
      services: z.object({
        database: envoyServiceHealthSchema,
        storage: envoyServiceHealthSchema,
        github: envoyServiceHealthSchema,
      }),
    })
    .nullable(),
  uptime: z.number().nullable(),
  errorRate: z.number().nullable(),
  avgResponseTime: z.number().int().nullable(),
  totalRequests24h: z.number().int().nonnegative(),
  timeline: z.array(
    z.object({
      date: z.iso.date(),
      status: envoyDayStatusSchema,
      healthChecks: z.number().int().nonnegative(),
      requests: z.number().int().nonnegative(),
      errorRate: z.number().nonnegative(),
    }),
  ),
  errorsByCategory: z.array(
    z.object({
      category: z.string(),
      count: z.number().int().positive(),
      errors: z.array(z.string()),
    }),
  ),
  lastCheck: z.iso.datetime().nullable(),
});
export type EnvoyStatusStats = z.infer<typeof envoyStatusStatsSchema>;
