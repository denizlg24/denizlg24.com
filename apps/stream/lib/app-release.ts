import "server-only";

import { type AppRelease, compareVersions } from "@repo/schemas/stream";
import { z } from "zod";

const REPOSITORY =
  process.env.STREAM_RELEASE_REPOSITORY ?? "denizlg24/denizlg24.com";
const TAG_PREFIX = "stream-android-v";
const TTL_MS = 15 * 60 * 1000;

const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    body: z.string().nullable(),
    published_at: z.string().nullable(),
    assets: z.array(
      z.object({
        name: z.string(),
        size: z.number(),
        browser_download_url: z.url(),
      }),
    ),
  }),
);

/** First lines of the GitHub release body, without commit-style noise. */
function notesOf(body: string | null): string {
  return (body ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 12)
    .join("\n");
}

let cached: { at: number; value: AppRelease | null } | null = null;

/**
 * The newest published, signed Stream APK. GitHub is asked at most every
 * 15 minutes; the unauthenticated API allows 60 calls an hour per address.
 */
export async function latestAndroidRelease(): Promise<AppRelease | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "stream.denizlg24.com",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases?per_page=60`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);
  const releases = releasesSchema.parse(await response.json());
  const best = releases
    .filter(
      (release) =>
        release.tag_name.startsWith(TAG_PREFIX) &&
        !release.draft &&
        !release.prerelease &&
        release.published_at !== null &&
        release.assets.some((asset) => asset.name.endsWith(".apk")),
    )
    .sort((a, b) =>
      compareVersions(
        b.tag_name.slice(TAG_PREFIX.length),
        a.tag_name.slice(TAG_PREFIX.length),
      ),
    )[0];
  const apk = best?.assets.find((asset) => asset.name.endsWith(".apk"));
  const value: AppRelease | null =
    best && apk && best.published_at
      ? {
          version: best.tag_name.slice(TAG_PREFIX.length),
          url: apk.browser_download_url,
          notes: notesOf(best.body),
          publishedAt: new Date(best.published_at).toISOString(),
          sizeBytes: apk.size,
        }
      : null;
  cached = { at: Date.now(), value };
  return value;
}
