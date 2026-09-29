import { z } from "zod";

// Published by .github/workflows/macros-mobile.yml as
// `macros-android-v<version>` with `Macros-<version>.apk` attached. Those
// releases are never marked "latest" (the Envoy CLI owns that), so the newest
// is found by version among the tags.
const REPOSITORY =
  process.env.MACROS_GITHUB_REPOSITORY?.trim() || "denizlg24/denizlg24.com";
const TAG_PREFIX = "macros-android-v";
const LOOKUP_SECONDS = 300;

const refsSchema = z.array(z.object({ ref: z.string() }));

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export interface AndroidRelease {
  version: string;
  apkUrl: string;
}

/** Null when nothing is published yet; throws when GitHub cannot be read. */
export async function latestAndroidRelease(): Promise<AndroidRelease | null> {
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/git/matching-refs/tags/${TAG_PREFIX}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      next: { revalidate: LOOKUP_SECONDS },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} listing tags`);
  }

  const versions = refsSchema
    .parse(await response.json())
    .map(({ ref }) => ref.replace(`refs/tags/${TAG_PREFIX}`, ""))
    .filter((version) => /^\d+(\.\d+)*$/.test(version))
    .sort(compareVersions);
  const version = versions.at(-1);
  if (!version) return null;

  return {
    version,
    apkUrl: `https://github.com/${REPOSITORY}/releases/download/${TAG_PREFIX}${version}/Macros-${version}.apk`,
  };
}
