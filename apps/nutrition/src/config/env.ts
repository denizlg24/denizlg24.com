const DEFAULT_API_PORT = 3000;
const DEFAULT_MEILISEARCH_HOST = "https://search.denizlg24.com";
const DEFAULT_MEILISEARCH_INDEX = "deniz-nutrition-api_foods";
const DEFAULT_MEILISEARCH_TIMEOUT_MS = 5_000;
const DEFAULT_RATE_LIMIT_MAX = 120;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

const readString = (key: string) => Bun.env[key];

const readRequiredString = (key: string) => {
  const value = readString(key);

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

const readNumber = (key: string, fallback: number) => {
  const value = readString(key);

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be a finite number`);
  }

  return parsed;
};

export const env = {
  apiPort: readNumber("API_PORT", readNumber("PORT", DEFAULT_API_PORT)),
  databaseUrl: readRequiredString("DATABASE_URL"),
  logLevel: readString("LOG_LEVEL") ?? "info",
  meilisearchApiKey: readRequiredString("MEILISEARCH_API_KEY"),
  meilisearchHost: readString("MEILISEARCH_HOST") ?? DEFAULT_MEILISEARCH_HOST,
  meilisearchIndex:
    readString("MEILISEARCH_INDEX") ?? DEFAULT_MEILISEARCH_INDEX,
  meilisearchTimeoutMs: readNumber(
    "MEILISEARCH_TIMEOUT_MS",
    DEFAULT_MEILISEARCH_TIMEOUT_MS,
  ),
  nodeEnv: readString("NODE_ENV") ?? "development",
  rateLimitMax: readNumber("RATE_LIMIT_MAX", DEFAULT_RATE_LIMIT_MAX),
  rateLimitWindowMs: readNumber(
    "RATE_LIMIT_WINDOW_MS",
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  ),
  redisUrl: readRequiredString("REDIS_URL"),
  /** Unset, the moderation routes refuse every request. */
  moderationToken: readString("NUTRITION_MODERATION_TOKEN"),
  /** Forge-provisioned Redis users may only touch keys under `<prefix>:`. */
  redisKeyPrefix: readString("REDIS_KEY_PREFIX"),
} as const;
