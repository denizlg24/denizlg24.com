/**
 * A notification's `url` as an in-app path: `dashboard://inbox?view=triage`
 * → `/inbox?view=triage`. Anything not ours is ignored.
 */
export function pathFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const match = /^dashboard:\/\/(.*)$/.exec(url);
  if (!match) return null;
  return `/${match[1] ?? ""}`;
}
