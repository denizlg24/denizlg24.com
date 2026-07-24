export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

// apps/api and apps/web share the monorepo .env, but MONGODB_URI and
// BETTER_AUTH_URL there belong to apps/web. The cloud side takes the _CLOUD
// variant whenever it is set, so loading the shared file is enough — no shell
// prelude has to remap the names before the process starts.
export function cloudEnv(name: string): string {
  const cloudValue = process.env[`${name}_CLOUD`]?.trim();
  return cloudValue || requiredEnv(name);
}
