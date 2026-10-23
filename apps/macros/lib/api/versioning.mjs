// These legacy handlers ARE the v1 contract. Keep them backward compatible;
// breaking behavior belongs in physical app/api/v2 routes, never these handlers.
// Do not derive this list or its version from whichever API is newest.
export const V1_API_ROOTS = Object.freeze([
  "account",
  "app",
  "body",
  "cache-versions",
  "changelog",
  "food-log",
  "foods",
  "habits",
  "health-import",
  "health-sync",
  "meal-templates",
  "moderation",
  "notifications",
  "nutrition-plans",
  "nutrition-programs",
  "pantry",
  "profile",
  "push",
  "recipes",
  "register",
  "shopping-list",
  "statistics",
  "strategy",
  "vision",
  "weight",
  "weight-goals",
]);

/** Internal rewrites retain the original HTTP method, body, cookies and query. */
export function v1ApiRewrites() {
  return V1_API_ROOTS.map((root) => ({
    source: `/api/v1/${root}/:path*`,
    destination: `/api/${root}/:path*`,
  }));
}
