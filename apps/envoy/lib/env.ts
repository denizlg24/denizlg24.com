import { z } from "zod";

const storageEnvSchema = z.object({
  ENVOY_S3_ENDPOINT: z.url(),
  ENVOY_S3_REGION: z.string().min(1).default("eu-west-1"),
  ENVOY_S3_ACCESS_KEY_ID: z.string().min(1),
  ENVOY_S3_SECRET_ACCESS_KEY: z.string().min(1),
  ENVOY_S3_BUCKET: z.string().min(1),
  // Temporary read-only fallback while existing Cloudflare R2 objects are
  // copied into denizlg24 cloud S3. These names match the old deployment.
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
});

const envSchema = storageEnvSchema.extend({
  ENVOY_DATABASE_URL: z.url(),
  ENVOY_GITHUB_CLIENT_ID: z.string().min(1),
  ENVOY_GITHUB_CLIENT_SECRET: z.string().min(1),
  ENVOY_CRON_SECRET: z.string().min(1).optional(),
});

export type EnvoyStorageEnv = z.infer<typeof storageEnvSchema>;
export type EnvoyEnv = z.infer<typeof envSchema>;

export function getEnv(): EnvoyEnv {
  return envSchema.parse(process.env);
}

export function getStorageEnv(): EnvoyStorageEnv {
  return storageEnvSchema.parse(process.env);
}
