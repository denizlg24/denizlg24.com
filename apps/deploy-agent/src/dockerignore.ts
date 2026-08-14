import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A compiled `.dockerignore`, matching the way the daemon reads one.
 *
 * The build context is not the checkout. Anything `.dockerignore` excludes is
 * absent from what BuildKit sees, so a path that exists on disk can still be a
 * `COPY` that fails to resolve — and a literal source (no wildcard) that
 * resolves to nothing is a hard build failure, not a skipped copy.
 */
export interface DockerignoreMatcher {
  /** True when the daemon would leave this path out of the build context. */
  excludes(path: string): boolean;
  /** False when nothing was ignored, so callers can skip filtering entirely. */
  hasPatterns: boolean;
}

interface CompiledPattern {
  exclusion: boolean;
  regex: RegExp;
}

const ALLOW_EVERYTHING: DockerignoreMatcher = {
  excludes: () => false,
  hasPatterns: false,
};

/** Go's `filepath.Clean` over a slash-separated path, which is what Docker applies. */
function cleanPath(value: string): string {
  const rooted = value.startsWith("/");
  const out: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
        continue;
      }
      if (rooted) continue;
      out.push("..");
      continue;
    }
    out.push(segment);
  }
  const cleaned = out.join("/");
  if (rooted) return `/${cleaned}`;
  return cleaned === "" ? "." : cleaned;
}

const REGEX_METACHARACTERS = new Set([
  ".",
  "+",
  "(",
  ")",
  "|",
  "{",
  "}",
  "$",
  "^",
  "[",
  "]",
]);

/**
 * The daemon's pattern-to-regexp translation, segment-aware.
 *
 * `*` and `?` never cross a separator; `**` matches any run of segments. This
 * is Go's `filepath.Match` plus Docker's `**` extension, not glob semantics
 * from any one shell, so it is transcribed rather than delegated to a matcher
 * that is merely close.
 */
function compilePattern(pattern: string): RegExp | null {
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    const character = pattern.charAt(index);
    index += 1;
    if (character === "*") {
      if (pattern[index] === "*") {
        index += 1;
        if (pattern[index] === "/") index += 1;
        source += index >= pattern.length ? ".*" : "((.*\\/)|([^\\/]*))";
        continue;
      }
      source += "[^\\/]*";
      continue;
    }
    if (character === "?") {
      source += "[^\\/]";
      continue;
    }
    if (character === "\\") {
      // A backslash escapes the next character; on its own it is literal.
      const next = pattern[index];
      if (next === undefined) {
        source += "\\\\";
        continue;
      }
      index += 1;
      source += REGEX_METACHARACTERS.has(next) ? `\\${next}` : next;
      continue;
    }
    source += REGEX_METACHARACTERS.has(character)
      ? `\\${character}`
      : character;
  }
  try {
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

/** Parses `.dockerignore` text into the daemon's ordered pattern list. */
export function compileDockerignore(contents: string): DockerignoreMatcher {
  const patterns: CompiledPattern[] = [];
  for (const rawLine of contents.split("\n")) {
    let line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const exclusion = line.startsWith("!");
    if (exclusion) {
      line = line.slice(1).trim();
      if (line === "") continue;
    }
    line = cleanPath(line.replace(/\\/g, "/"));
    if (line.length > 1 && line.startsWith("/")) line = line.slice(1);
    if (line === "." || line === "") continue;
    const regex = compilePattern(line);
    if (regex === null) continue;
    patterns.push({ exclusion, regex });
  }

  if (patterns.length === 0) return ALLOW_EVERYTHING;

  return {
    hasPatterns: true,
    excludes(path: string): boolean {
      const target = cleanPath(path.replace(/\\/g, "/"));
      const segments = target.split("/");
      // A path is out when it matches, and equally when any directory above it
      // does: `infra` in a .dockerignore takes `infra/compose/scripts` with it.
      const candidates = segments.map((_, index) =>
        segments.slice(0, index + 1).join("/"),
      );
      let matched = false;
      for (const pattern of patterns) {
        // Last match wins, so a pattern that cannot change the verdict — an
        // exclusion against an already-excluded path, or the reverse — is skipped.
        if (pattern.exclusion !== matched) continue;
        if (candidates.some((candidate) => pattern.regex.test(candidate))) {
          matched = !pattern.exclusion;
        }
      }
      return matched;
    },
  };
}

/**
 * Reads the `.dockerignore` that applies to a build.
 *
 * BuildKit prefers one named after the Dockerfile — `.nixpacks/Dockerfile.dockerignore`
 * for a generated build — and falls back to the context root. Missing is not an
 * error: most repositories have none.
 */
export async function loadDockerignore(
  contextDirectory: string,
  dockerfilePath?: string | null,
): Promise<DockerignoreMatcher> {
  const candidates = [
    ...(dockerfilePath
      ? [join(contextDirectory, `${dockerfilePath}.dockerignore`)]
      : []),
    join(contextDirectory, ".dockerignore"),
  ];
  for (const candidate of candidates) {
    const contents = await readFile(candidate, "utf8").catch(() => null);
    if (contents !== null) return compileDockerignore(contents);
  }
  return ALLOW_EVERYTHING;
}
