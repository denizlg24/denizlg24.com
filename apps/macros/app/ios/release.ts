import { z } from "zod";

export const APP_STORE_ID = "6819799859";
export const APP_STORE_HREF = `https://apps.apple.com/app/id${APP_STORE_ID}`;

const LOOKUP_SECONDS = 3600;

const lookupSchema = z.object({
  results: z.array(z.object({ version: z.string() })),
});

/**
 * The version Apple is serving now. App Store Connect's own API would also
 * report builds still in review, so this asks the public lookup instead.
 * Null when Apple has nothing listed; throws when the lookup cannot be read.
 */
export async function latestAppStoreVersion(): Promise<string | null> {
  const response = await fetch(
    `https://itunes.apple.com/lookup?id=${APP_STORE_ID}`,
    {
      next: { revalidate: LOOKUP_SECONDS },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`App Store lookup answered ${response.status}`);
  }
  return lookupSchema.parse(await response.json()).results[0]?.version ?? null;
}
