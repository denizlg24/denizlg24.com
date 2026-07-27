/**
 * Files the operating system writes to — or probes on — a network volume for
 * its own bookkeeping, which no user ever asked to store.
 *
 * Finder writes `.DS_Store` into every directory it displays and an AppleDouble
 * `._name` beside every file it copies — WebDAV carries no extended attributes,
 * so it falls back to sidecar files whether or not there is anything to put in
 * them. Explorer probes `Desktop.ini` and `AutoRun.inf` on every volume it
 * mounts. Left alone these outnumber the real files, land in the search index,
 * and follow the data into every archive and COPY.
 *
 * Writes are answered as though they succeeded, then dropped. Refusing them
 * outright surfaces in Finder as a failed copy of the file the sidecar belongs
 * to, which is worse than losing metadata nothing here reads. The tradeoff is
 * that a genuine resource fork does not survive a round trip through the mount.
 *
 * Reads are answered 404, which is the truth — nothing was stored. Synthesizing
 * these instead would mean inventing folder chrome nobody configured and, for
 * `AutoRun.inf`, serving an autorun manifest off a network share. Neither is
 * worth doing, so the probe stays unanswered and the *logging* is what gets
 * filtered.
 */
// Lowercase, and compared lowercased. Both operating systems treat these names
// case-insensitively and spell them inconsistently — Explorer asks for
// `Desktop.ini` and writes `desktop.ini` — while the filesystem underneath is
// case-sensitive, so matching exactly would store one spelling and drop the
// other.
const OS_METADATA_NAMES = new Set([
  ".ds_store",
  ".localized",
  ".apdisk",
  "desktop.ini",
  "autorun.inf",
  "thumbs.db",
  ".spotlight-v100",
  ".temporaryitems",
  ".trashes",
  ".fseventsd",
  ".documentrevisions-v100",
]);
const OS_METADATA_PREFIXES = ["._"];

export function isOsMetadataName(name: string): boolean {
  const lowered = name.toLowerCase();
  return (
    OS_METADATA_NAMES.has(lowered) ||
    OS_METADATA_PREFIXES.some((prefix) => lowered.startsWith(prefix))
  );
}

/**
 * Matches on the last segment, so it reads a storage path and a request path
 * alike. Request paths arrive percent-encoded, but none of these names contain
 * a character that survives encoding as anything else.
 */
export function isOsMetadataPath(path: string): boolean {
  return isOsMetadataName(path.slice(path.lastIndexOf("/") + 1));
}
