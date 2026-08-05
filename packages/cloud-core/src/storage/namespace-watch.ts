/**
 * The wire shape of the watch stream, and the one path rule it needs.
 *
 * The watch itself is `NamespaceWatcher`; this is only what crosses the socket
 * between the privileged host service and the API.
 */

export type NamespaceWatchMessage =
  /** Sent once per subscriber, so a subscriber knows the watch is live. */
  | { type: "ready" }
  | { type: "paths"; paths: string[] }
  /**
   * The watch can no longer claim to have seen everything. The subscriber must
   * treat the projection as dirty and fall back to a full scan; nothing in this
   * message says what was missed, because the watcher does not know.
   */
  | { type: "overflow"; reason: string };

/**
 * Normalises a raw watch filename into a namespace-relative path.
 *
 * Returns null for anything the projection must not act on. A watch rooted at
 * the namespace reports paths relative to it, but the reserved entries — the
 * mount witness, branch markers, migration temporaries and AppleDouble
 * sidecars — are internal bookkeeping that no projection row corresponds to.
 *
 * The result carries no leading slash, matching what the metadata service emits
 * and what the projection repository stores; the repository prepends the slash
 * itself, so a leading one here becomes a doubled separator in every path.
 */
export function watchPathToRelative(
  filename: string | null,
  isReservedSegment: (segment: string) => boolean,
): string | null {
  if (!filename) return null;
  const segments = filename.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment === "." || segment === "..") return null;
    if (isReservedSegment(segment)) return null;
  }
  return segments.join("/");
}
