/**
 * Builds the AltStore-format source SideStore reads to install and update
 * Macros. Format: https://faq.altstore.io/developers/make-a-source
 *
 * Two SideStore-specific rules shape it:
 * - No `marketplaceID` and no `buildVersion`. SideStore reads either as an
 *   AltStore PAL (notarised) source and refuses to add it.
 * - Without `buildVersion`, `version` alone decides whether an update exists,
 *   so every published IPA must carry a new CFBundleShortVersionString. The
 *   release workflow only publishes when package.json's version changes.
 */

export interface ReleaseMetadata {
  version: string;
  /** CFBundleVersion. Recorded for traceability; deliberately not published. */
  buildNumber: string;
  /** ISO 8601 timestamp of the release. */
  date: string;
  size: number;
  downloadURL: string;
  minOSVersion: string;
  localizedDescription: string;
  /** Every `NS*UsageDescription` in the built Info.plist. */
  privacy: Record<string, string>;
  entitlements: string[];
}

export interface AppListing {
  name: string;
  bundleIdentifier: string;
  developerName: string;
  subtitle: string;
  localizedDescription: string;
  iconURL: string;
  tintColor: string;
  category: string;
}

export interface SourceListing {
  name: string;
  subtitle: string;
  description: string;
  iconURL: string;
  website: string;
  tintColor: string;
}

export interface AltSourceVersion {
  version: string;
  date: string;
  localizedDescription: string;
  downloadURL: string;
  size: number;
  minOSVersion: string;
}

export interface AltSource extends SourceListing {
  apps: Array<
    AppListing & {
      screenshots: string[];
      versions: AltSourceVersion[];
      appPermissions: {
        entitlements: string[];
        privacy: Record<string, string>;
      };
    }
  >;
  news: [];
}

function parseVersion(version: string): number[] {
  return version.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

/** Descending semver-ish comparison; missing components count as 0. */
export function compareVersionsDescending(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const VERSION_PATTERN = /^\d+(\.\d+){0,2}$/;

export function assertReleaseMetadata(value: unknown): ReleaseMetadata {
  if (!value || typeof value !== "object") {
    throw new Error("Release metadata must be an object");
  }
  const record = value as Record<string, unknown>;
  const requireString = (key: string) => {
    const field = record[key];
    if (typeof field !== "string" || field.length === 0) {
      throw new Error(`Release metadata is missing "${key}"`);
    }
    return field;
  };
  const version = requireString("version");
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`"${version}" is not a CFBundleShortVersionString`);
  }
  const size = record.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    throw new Error(`Release ${version} has no IPA size`);
  }
  const privacy = record.privacy;
  if (!privacy || typeof privacy !== "object") {
    throw new Error(`Release ${version} has no privacy map`);
  }
  const privacyEntries = Object.entries(privacy).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  const entitlements = Array.isArray(record.entitlements)
    ? record.entitlements.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];

  return {
    version,
    buildNumber: requireString("buildNumber"),
    date: requireString("date"),
    size,
    downloadURL: requireString("downloadURL"),
    minOSVersion: requireString("minOSVersion"),
    localizedDescription: requireString("localizedDescription"),
    privacy: Object.fromEntries(privacyEntries),
    entitlements,
  };
}

export function composeSource(
  source: SourceListing,
  app: AppListing,
  releases: ReleaseMetadata[],
): AltSource {
  if (releases.length === 0) {
    throw new Error("A source needs at least one release");
  }

  const seen = new Set<string>();
  const ordered = [...releases]
    .sort((a, b) => compareVersionsDescending(a.version, b.version))
    .filter((release) => {
      if (seen.has(release.version)) return false;
      seen.add(release.version);
      return true;
    });
  const latest = ordered[0];
  if (!latest) throw new Error("A source needs at least one release");

  return {
    ...source,
    apps: [
      {
        ...app,
        screenshots: [],
        versions: ordered.map((release) => ({
          version: release.version,
          date: release.date,
          localizedDescription: release.localizedDescription,
          downloadURL: release.downloadURL,
          size: release.size,
          minOSVersion: release.minOSVersion,
        })),
        // SideStore compares these against the IPA it downloads; they must
        // describe the newest build exactly.
        appPermissions: {
          entitlements: [...latest.entitlements].sort(),
          privacy: Object.fromEntries(
            Object.entries(latest.privacy).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          ),
        },
      },
    ],
    news: [],
  };
}

/** `NS*UsageDescription` keys from a parsed Info.plist. */
export function privacyFromInfoPlist(
  infoPlist: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(infoPlist).filter(
      (entry): entry is [string, string] =>
        /^NS\w+UsageDescription$/.test(entry[0]) &&
        typeof entry[1] === "string",
    ),
  );
}
