import { PHASE_PRODUCTION_BUILD } from "next/constants";

export function isProductionBuild() {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
}

/**
 * A build that cannot reach the database still ships: the page renders from
 * `fallback` and the next revalidation fills it in. At runtime the error is
 * rethrown, so Next keeps serving the last good render instead of caching an
 * empty one.
 */
export async function failOpenAtBuild<T>(
  label: string,
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isProductionBuild()) throw error;
    console.warn(
      `[macros] ${label} unavailable at build, rendering on request instead:`,
      error instanceof Error ? error.message : error,
    );
    return fallback;
  }
}
