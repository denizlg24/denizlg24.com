/**
 * What the "Branch, Commit, or URL" field accepts, resolved to the one thing
 * the deploy routes take: a ref to hand GitHub.
 *
 * A URL is parsed rather than passed through because `refs/heads/x` and
 * `tree/x` are not refs GitHub's commits endpoint resolves, and because a URL
 * naming a *different* repository has to be refused. Silently building this
 * repository's `main` because the pasted link happened to end in `/tree/main`
 * is the worst answer available.
 */

export type RefInput =
  | { kind: "branch"; ref: string }
  | { kind: "sha"; ref: string };

export type RefInputResult =
  | { ok: true; input: RefInput }
  | { ok: false; reason: "empty" | "wrong-repository" | "unrecognised" };

const SHA = /^[0-9a-f]{7,40}$/i;

/** `tree` and `commit(s)` are the two GitHub paths that name a revision. */
const REVISION_SEGMENTS = new Set(["tree", "commit", "commits"]);

function classify(ref: string): RefInput {
  return SHA.test(ref) ? { kind: "sha", ref } : { kind: "branch", ref };
}

function stripRefPrefix(value: string): string {
  return value.startsWith("refs/heads/")
    ? value.slice("refs/heads/".length)
    : value;
}

export function parseRefInput(
  raw: string,
  repository: { owner: string; name: string },
): RefInputResult {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return { ok: false, reason: "empty" };

  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: true, input: classify(stripRefPrefix(trimmed)) };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "unrecognised" };
  }

  const segments = url.pathname.split("/").filter((part) => part.length > 0);
  const [owner, name, kind, ...rest] = segments;
  if (owner === undefined || name === undefined) {
    return { ok: false, reason: "unrecognised" };
  }
  if (
    owner.toLowerCase() !== repository.owner.toLowerCase() ||
    name.replace(/\.git$/, "").toLowerCase() !== repository.name.toLowerCase()
  ) {
    return { ok: false, reason: "wrong-repository" };
  }

  // The repository root names the default branch, which the caller resolves as
  // HEAD rather than by guessing which branch that is.
  if (kind === undefined)
    return { ok: true, input: { kind: "branch", ref: "HEAD" } };
  if (!REVISION_SEGMENTS.has(kind))
    return { ok: false, reason: "unrecognised" };

  // Rejoined, not taken as one segment: a branch name may contain slashes, and
  // `dependabot/bun/minor-and-patch-ad1c0728bc` arrives as three of them.
  const ref = decodeURIComponent(rest.join("/"));
  if (ref.length === 0) return { ok: false, reason: "unrecognised" };
  return { ok: true, input: classify(ref) };
}
