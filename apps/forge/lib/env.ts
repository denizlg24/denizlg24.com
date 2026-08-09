// NEXT_PUBLIC_* values are inlined at build time. Localhost is intentional: a
// production build missing its Vercel/Forge configuration must fail visibly.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_CLOUD_API_URL ?? "http://localhost:3001";
