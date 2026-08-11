/**
 * File-level import resolution across a workspace monorepo.
 *
 * The workspace matcher in `github/changes.ts` answers a coarser question: does
 * this target depend on the package the change landed in. That is enough to
 * keep one application from rebuilding when a sibling application changes, and
 * badly insufficient for a shared package that several applications enter
 * through different subpaths. `@repo/schemas` exports `.`, `./cloud` and
 * `./envoy`; the cloud applications only ever import `./cloud`, so a change to
 * a schema reachable only from `.` cannot affect them — and yet every target
 * rebuilt, because the matcher only knew the dependency edge existed.
 *
 * This module walks the actual imports. It is deliberately not a bundler: it
 * resolves what it can prove and reports everything else as opaque, and an
 * opaque workspace is watched whole. Being wrong in that direction costs a
 * rebuild; being wrong in the other direction silently drops a deployment.
 */

import { detectWorkspaces, type RepoInspector } from "./detect";

const TRAVERSABLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/** Tried in order against a specifier that carries no extension of its own. */
const RESOLUTION_SUFFIXES: readonly string[] = [
  "",
  ...TRAVERSABLE_EXTENSIONS,
  ...TRAVERSABLE_EXTENSIONS.map((extension) => `/index${extension}`),
];

/**
 * A `.js` specifier in TypeScript source usually names a `.ts` file — the
 * extension is what the emitted JavaScript will import, not what is on disk.
 */
const REWRITTEN_EXTENSIONS: ReadonlyArray<
  readonly [string, readonly string[]]
> = [
  [".js", [".ts", ".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
  [".jsx", [".tsx"]],
];

/** Anything here is build output or tooling that no import graph reaches. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
]);

const MAX_TSCONFIG_EXTENDS_DEPTH = 8;

/**
 * Reads the manifest of every declared workspace. A directory with no readable
 * `package.json` is left out: it is addressable by no import, and its own files
 * are covered by whichever target has it as a root directory.
 */
export async function collectGraphWorkspaces(
  repo: RepoInspector,
): Promise<ModuleGraphWorkspace[]> {
  const workspaces = await detectWorkspaces(repo);
  const read = await Promise.all(
    workspaces.map(async (workspace) =>
      readGraphWorkspace(
        workspace.path,
        await repo.readFile(`${workspace.path}/package.json`),
      ),
    ),
  );
  return read.filter(
    (workspace): workspace is ModuleGraphWorkspace => workspace !== null,
  );
}

export interface ModuleGraphFs {
  /** Null when the path is absent or unreadable. */
  readFile(path: string): Promise<string | null>;
  /**
   * Every file beneath `directory`, repository-relative, recursively. Null when
   * the directory does not exist. Implementations prune `SKIPPED_DIRECTORIES`.
   */
  listFiles(directory: string): Promise<string[] | null>;
}

export interface ModuleGraphWorkspace {
  /** Repository-relative directory, e.g. `packages/schemas`. */
  path: string;
  /** The `name` in its `package.json`, e.g. `@repo/schemas`. */
  name: string;
  /** Raw `exports` field, whatever shape it took. */
  exports: unknown;
  main: string | null;
  module: string | null;
  types: string | null;
}

/**
 * The result of walking one target's imports, in the form the control plane
 * stores and later matches changed files against.
 */
export interface ModuleGraph {
  /** The commit the walk ran against. Informational; matching does not use it. */
  sha: string;
  /** The target's own directory. Everything inside it is watched regardless. */
  rootDirectory: string;
  /**
   * Repository-relative files outside `rootDirectory` that the target reaches.
   * Sorted, so a stored graph diffs cleanly between builds.
   */
  files: string[];
  /**
   * Workspace directories whose graph could not be resolved. Every file in one
   * is watched, which is what the coarse matcher did for all of them.
   */
  opaqueWorkspaces: string[];
  /**
   * False when the walk hit its budget or could not read the target at all. A
   * graph that is not complete never justifies skipping a deployment.
   */
  complete: boolean;
}

export interface ResolveModuleGraphOptions {
  fs: ModuleGraphFs;
  workspaces: ModuleGraphWorkspace[];
  /** The deploy target's directory, e.g. `apps/api`. */
  rootDirectory: string;
  sha: string;
  /** Files read before the walk gives up and reports itself incomplete. */
  fileBudget?: number;
  /**
   * Reports each hole as it is found. A build log that says which import made a
   * package opaque is the difference between fixing it and re-deriving it.
   */
  onOpaque?: (detail: {
    file: string;
    specifier: string | null;
    workspace: string | null;
  }) => void;
}

const DEFAULT_FILE_BUDGET = 40_000;

export function normaliseGraphPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
}

export function pathIsInside(path: string, directory: string): boolean {
  if (!directory) return true;
  return path === directory || path.startsWith(`${directory}/`);
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** Resolves `..` and `.` without pulling in `node:path` semantics. */
function joinRelative(from: string, specifier: string): string | null {
  const segments = from ? from.split("/") : [];
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function isTraversable(path: string): boolean {
  return TRAVERSABLE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function isTraversableSource(path: string): boolean {
  return isTraversable(normaliseGraphPath(path));
}

function readStringField(
  pkg: Record<string, unknown>,
  key: string,
): string | null {
  const value = pkg[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Builds the workspace record this module needs from a parsed `package.json`.
 * Returns null when the manifest has no name, which makes it unaddressable by
 * any import and therefore not part of the graph.
 */
export function readGraphWorkspace(
  path: string,
  raw: string | null,
): ModuleGraphWorkspace | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const pkg = parsed as Record<string, unknown>;
  const name = readStringField(pkg, "name");
  if (!name) return null;
  return {
    path: normaliseGraphPath(path),
    name,
    exports: pkg.exports,
    main: readStringField(pkg, "main"),
    module: readStringField(pkg, "module"),
    types: readStringField(pkg, "types"),
  };
}

/**
 * Every string leaf under an `exports` value. Conditions (`import`, `require`,
 * `types`, `default`) are not evaluated: which one a bundler picks does not
 * change whether editing the file behind another one should rebuild.
 */
function exportTargets(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) exportTargets(entry, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      exportTargets(entry, into);
    }
  }
}

/**
 * The file candidates a subpath of a workspace names, before existence checks.
 * `subpath` is `.` for a bare `@repo/x` import and `./cloud` for `@repo/x/cloud`.
 */
export function entryCandidates(
  workspace: ModuleGraphWorkspace,
  subpath: string,
): string[] {
  const candidates: string[] = [];
  const exportsField = workspace.exports;

  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    // A bare string or array form only ever describes the root export.
    if (subpath === ".") exportTargets(exportsField, candidates);
  } else if (exportsField !== null && typeof exportsField === "object") {
    const map = exportsField as Record<string, unknown>;
    const keys = Object.keys(map);
    if (!keys.some((key) => key.startsWith("."))) {
      // A pure conditions object (`{ import, require }`) is the root export.
      if (subpath === ".") exportTargets(exportsField, candidates);
    } else if (map[subpath] !== undefined) {
      exportTargets(map[subpath], candidates);
    } else {
      // Pattern keys: `"./*": "./src/*.ts"`. Longest prefix wins, which is what
      // Node does and what makes a specific key beat a catch-all.
      const patterns = keys
        .filter((key) => key.includes("*"))
        .sort((left, right) => right.length - left.length);
      for (const pattern of patterns) {
        const star = pattern.indexOf("*");
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        if (!subpath.startsWith(prefix)) continue;
        if (suffix && !subpath.endsWith(suffix)) continue;
        const filled = subpath.slice(
          prefix.length,
          subpath.length - suffix.length,
        );
        const replacements: string[] = [];
        exportTargets(map[pattern], replacements);
        for (const replacement of replacements) {
          candidates.push(replacement.replaceAll("*", filled));
        }
        if (candidates.length > 0) break;
      }
    }
  }

  if (candidates.length === 0 && subpath === ".") {
    // No usable `exports`. `main`/`module` are the legacy answer, and a package
    // with neither resolves to an index file the probe list will find.
    for (const field of [workspace.module, workspace.main, workspace.types]) {
      if (field) candidates.push(field);
    }
    if (candidates.length === 0) candidates.push("./index", "./src/index");
  }

  // No `exports` map at all means unrestricted deep imports, the pre-exports
  // behaviour every workspace package without the field still has.
  if (candidates.length === 0 && subpath !== "." && !workspace.exports) {
    candidates.push(subpath);
  }

  const resolved: string[] = [];
  for (const candidate of candidates) {
    const joined = joinRelative(workspace.path, candidate);
    if (joined) resolved.push(joined);
  }
  return resolved;
}

/**
 * Import specifiers in a source file.
 *
 * Regex rather than a parser, and tuned to over-match: a specifier picked up
 * from a comment adds a file to the watch set, while one that is missed drops a
 * deployment. `dynamic` reports a computed `import()`/`require()`, which cannot
 * be resolved statically and makes the containing workspace opaque.
 */
export function extractSpecifiers(source: string): {
  specifiers: string[];
  dynamic: boolean;
} {
  const specifiers = new Set<string>();
  const patterns = [
    /\bfrom\s*["']([^"'\n]+)["']/g,
    /\bimport\s+["']([^"'\n]+)["']/g,
    /\bimport\s*\(\s*["']([^"'\n]+)["']/g,
    /\brequire\s*\(\s*["']([^"'\n]+)["']/g,
    /\brequire\s*\.\s*resolve\s*\(\s*["']([^"'\n]+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) specifiers.add(specifier);
    }
  }

  // A call opening on anything but a quote: a template literal, a variable,
  // another call. The set of files that reaches is unbounded.
  //
  // Comments are stripped for this test and only this test. Extraction stays on
  // the raw source because a specifier picked out of prose only widens the watch
  // set, while one word of prose naming a computed import would make the whole
  // package opaque — as the paragraph above this line did.
  const code = stripComments(source);
  const dynamic =
    /\bimport\s*\(\s*[^"'\s)]/.test(code) ||
    /\brequire\s*\(\s*[^"'\s)]/.test(code);

  return { specifiers: [...specifiers], dynamic };
}

/** Replaces comments with a space, leaving string and template literals whole. */
function stripComments(source: string): string {
  return source.replace(
    /("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])*')|(`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, double, single, template) =>
      double || single || template ? match : " ",
  );
}

interface PathAlias {
  prefix: string;
  suffix: string;
  targets: string[];
}

interface TsconfigPaths {
  /** Directory the alias targets resolve against. */
  base: string;
  aliases: PathAlias[];
}

interface WalkState {
  readonly fs: ModuleGraphFs;
  readonly byName: Map<string, ModuleGraphWorkspace>;
  /** Longest-first, so a nested workspace beats its parent. */
  readonly byPath: ModuleGraphWorkspace[];
  readonly visited: Set<string>;
  readonly reached: Set<string>;
  readonly opaque: Set<string>;
  readonly tsconfigs: Map<string, TsconfigPaths | null>;
  readonly onOpaque: ResolveModuleGraphOptions["onOpaque"];
  budget: number;
  complete: boolean;
}

function owningWorkspace(
  state: WalkState,
  path: string,
): ModuleGraphWorkspace | null {
  return (
    state.byPath.find((workspace) => pathIsInside(path, workspace.path)) ?? null
  );
}

/**
 * Records that some part of a workspace could not be followed. A hole with no
 * workspace to blame — a file outside every declared one — cannot be contained,
 * so the whole graph is reported unusable instead.
 */
function markOpaque(
  state: WalkState,
  workspace: ModuleGraphWorkspace | null,
  detail: { file: string; specifier: string | null },
) {
  if (workspace) state.opaque.add(workspace.path);
  else state.complete = false;
  state.onOpaque?.({ ...detail, workspace: workspace?.path ?? null });
}

/** JSON with comments and trailing commas, which every tsconfig may carry. */
function parseJsonc(raw: string): unknown {
  const stripped = raw
    .replace(
      /\\"|"(?:\\"|[^"])*"|(\/\/.*$)|(\/\*[\s\S]*?\*\/)/gm,
      (match, line, block) => (line || block ? "" : match),
    )
    .replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function compilerOptionsOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object") return null;
  const options = (value as { compilerOptions?: unknown }).compilerOptions;
  if (options === null || typeof options !== "object") return null;
  return options as Record<string, unknown>;
}

/**
 * `compilerOptions.paths` for a workspace, following `extends`.
 *
 * TypeScript does not merge `paths` across an extends chain — the nearest
 * config that declares it wins outright — so the walk stops at the first hit.
 */
async function loadTsconfigPaths(
  state: WalkState,
  workspace: ModuleGraphWorkspace,
): Promise<TsconfigPaths | null> {
  const cached = state.tsconfigs.get(workspace.path);
  if (cached !== undefined) return cached;
  state.tsconfigs.set(workspace.path, null);

  let current: string | null = null;
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const candidate = joinRelative(workspace.path, name);
    if (candidate && (await state.fs.readFile(candidate)) !== null) {
      current = candidate;
      break;
    }
  }

  for (
    let depth = 0;
    current && depth < MAX_TSCONFIG_EXTENDS_DEPTH;
    depth += 1
  ) {
    const raw: string | null = await state.fs.readFile(current);
    const options = raw === null ? null : compilerOptionsOf(parseJsonc(raw));
    const directory = dirname(current);

    const paths = options?.paths;
    if (paths !== null && typeof paths === "object") {
      const baseUrl =
        typeof options?.baseUrl === "string" ? options.baseUrl : ".";
      const base = joinRelative(directory, baseUrl) ?? directory;
      const aliases: PathAlias[] = [];
      for (const [key, value] of Object.entries(
        paths as Record<string, unknown>,
      )) {
        if (!Array.isArray(value)) continue;
        const targets = value.filter(
          (entry): entry is string => typeof entry === "string",
        );
        if (targets.length === 0) continue;
        const star = key.indexOf("*");
        aliases.push(
          star === -1
            ? { prefix: key, suffix: "", targets }
            : {
                prefix: key.slice(0, star),
                suffix: key.slice(star + 1),
                targets,
              },
        );
      }
      if (aliases.length > 0) {
        const resolved = { base, aliases };
        state.tsconfigs.set(workspace.path, resolved);
        return resolved;
      }
    }

    const extendsField = (
      raw === null ? null : (parseJsonc(raw) as { extends?: unknown } | null)
    )?.extends;
    const next = Array.isArray(extendsField)
      ? extendsField.find((entry) => typeof entry === "string")
      : extendsField;
    if (typeof next !== "string") break;

    if (next.startsWith(".")) {
      const joined = joinRelative(directory, next);
      current = joined
        ? await firstExisting(state, [joined, `${joined}.json`])
        : null;
      continue;
    }
    // `@repo/typescript-config/base.json` — a workspace package plus a subpath.
    const scoped = next.startsWith("@");
    const segments = next.split("/");
    const packageName = scoped
      ? segments.slice(0, 2).join("/")
      : (segments[0] ?? next);
    const rest = segments.slice(scoped ? 2 : 1).join("/");
    const dependency = state.byName.get(packageName);
    if (!dependency) break;
    const joined = joinRelative(dependency.path, rest || "tsconfig.json");
    current = joined
      ? await firstExisting(state, [joined, `${joined}.json`])
      : null;
  }

  return state.tsconfigs.get(workspace.path) ?? null;
}

async function firstExisting(
  state: WalkState,
  candidates: string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if ((await state.fs.readFile(candidate)) !== null) return candidate;
  }
  return null;
}

/** Probes the on-disk forms a specifier without an extension can take. */
async function resolveFile(
  state: WalkState,
  candidate: string,
): Promise<string | null> {
  const attempts: string[] = [];
  for (const [from, replacements] of REWRITTEN_EXTENSIONS) {
    if (!candidate.endsWith(from)) continue;
    const stem = candidate.slice(0, -from.length);
    for (const replacement of replacements) attempts.push(stem + replacement);
  }
  for (const suffix of RESOLUTION_SUFFIXES) attempts.push(candidate + suffix);

  for (const attempt of attempts) {
    if (!attempt) continue;
    if (state.reached.has(attempt) || state.visited.has(attempt))
      return attempt;
    if (state.budget <= 0) {
      state.complete = false;
      return null;
    }
    state.budget -= 1;
    if ((await state.fs.readFile(attempt)) !== null) {
      state.reached.add(attempt);
      return attempt;
    }
  }
  return null;
}

/**
 * What one specifier, seen in `fromFile`, points at.
 *
 * `external` is no edge into the repository at all — a registry package, a
 * builtin, a URL. `opaque` is an edge that should have resolved and did not,
 * naming the workspace whose graph now has the hole: a broken relative import
 * belongs to the file that wrote it, an entry point that is not in the checkout
 * belongs to the package that declared it.
 */
type SpecifierResolution =
  | { kind: "file"; path: string }
  | { kind: "external" }
  | { kind: "opaque"; workspace: ModuleGraphWorkspace | null };

async function resolveSpecifier(
  state: WalkState,
  fromFile: string,
  specifier: string,
): Promise<SpecifierResolution> {
  const owner = owningWorkspace(state, fromFile);

  if (specifier.startsWith(".")) {
    const joined = joinRelative(dirname(fromFile), specifier);
    const path = joined === null ? null : await resolveFile(state, joined);
    return path ? { kind: "file", path } : { kind: "opaque", workspace: owner };
  }

  // Absolute, or a URL scheme (`node:`, `bun:`, `http:`, `data:`).
  if (specifier.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
    return { kind: "external" };
  }

  if (owner) {
    const tsconfig = await loadTsconfigPaths(state, owner);
    for (const alias of tsconfig?.aliases ?? []) {
      if (!specifier.startsWith(alias.prefix)) continue;
      if (alias.suffix && !specifier.endsWith(alias.suffix)) continue;
      const filled = specifier.slice(
        alias.prefix.length,
        specifier.length - alias.suffix.length,
      );
      for (const target of alias.targets) {
        const joined = joinRelative(
          tsconfig?.base ?? owner.path,
          target.replaceAll("*", filled),
        );
        const path = joined ? await resolveFile(state, joined) : null;
        if (path) return { kind: "file", path };
      }
      // The alias matched and named nothing on disk. An alias only ever points
      // inside the repository, so this is a hole rather than a registry package.
      return { kind: "opaque", workspace: owner };
    }
  }

  const scoped = specifier.startsWith("@");
  const segments = specifier.split("/");
  const packageName = scoped
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? specifier);
  const workspace = state.byName.get(packageName);
  // Not a workspace and not an alias: it resolves in `node_modules`, and a
  // version change there lands in the lockfile, which is a global build input.
  if (!workspace) return { kind: "external" };

  const rest = segments.slice(scoped ? 2 : 1).join("/");
  const subpath = rest ? `./${rest}` : ".";
  for (const candidate of entryCandidates(workspace, subpath)) {
    const path = await resolveFile(state, candidate);
    if (path) return { kind: "file", path };
  }
  // The package is ours and the entry is not in the repository — an `exports`
  // pointing at a `dist/` that only exists after a build. Nothing can be proven
  // about which of its sources matter, so the package is watched whole.
  return { kind: "opaque", workspace };
}

async function walk(state: WalkState, seed: string): Promise<void> {
  const queue = [seed];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    if (state.visited.has(current)) continue;
    state.visited.add(current);
    if (!isTraversable(current)) continue;

    if (state.budget <= 0) {
      state.complete = false;
      return;
    }
    state.budget -= 1;
    const source = await state.fs.readFile(current);
    if (source === null) {
      markOpaque(state, owningWorkspace(state, current), {
        file: current,
        specifier: null,
      });
      continue;
    }

    const { specifiers, dynamic } = extractSpecifiers(source);
    if (dynamic) {
      markOpaque(state, owningWorkspace(state, current), {
        file: current,
        specifier: "<computed>",
      });
    }

    for (const specifier of specifiers) {
      const resolved = await resolveSpecifier(state, current, specifier);
      if (resolved.kind === "external") continue;
      if (resolved.kind === "opaque") {
        markOpaque(state, resolved.workspace, { file: current, specifier });
        continue;
      }
      state.reached.add(resolved.path);
      if (!state.visited.has(resolved.path)) queue.push(resolved.path);
    }
  }
}

/**
 * Walks every source file in the target's directory and follows the imports out
 * of it, so the result is the set of files elsewhere in the repository that the
 * target reaches.
 *
 * The target's own files are all seeds rather than a resolved entry point: a
 * framework decides its own entries — file-system routes, config files, scripts
 * named in `package.json` — and guessing wrong drops real edges. Reading one
 * application directory is cheap; being wrong is not.
 */
export async function resolveModuleGraph(
  options: ResolveModuleGraphOptions,
): Promise<ModuleGraph> {
  const rootDirectory = normaliseGraphPath(options.rootDirectory);
  const workspaces = options.workspaces.map((workspace) => ({
    ...workspace,
    path: normaliseGraphPath(workspace.path),
  }));
  // A target can sit in a directory the repository never declared a workspace
  // for. Without an entry here it owns no `tsconfig.json`, so every `@/…` alias
  // in it resolves to nothing and the whole graph reports itself incomplete.
  if (!workspaces.some((workspace) => workspace.path === rootDirectory)) {
    workspaces.push({
      path: rootDirectory,
      name: ` deploy-target:${rootDirectory}`,
      exports: undefined,
      main: null,
      module: null,
      types: null,
    });
  }

  const state: WalkState = {
    fs: options.fs,
    byName: new Map(workspaces.map((workspace) => [workspace.name, workspace])),
    byPath: [...workspaces].sort(
      (left, right) => right.path.length - left.path.length,
    ),
    visited: new Set(),
    reached: new Set(),
    opaque: new Set(),
    tsconfigs: new Map(),
    onOpaque: options.onOpaque,
    budget: options.fileBudget ?? DEFAULT_FILE_BUDGET,
    complete: true,
  };

  const seeds = await options.fs.listFiles(rootDirectory);
  if (seeds === null) {
    return {
      sha: options.sha,
      rootDirectory,
      files: [],
      opaqueWorkspaces: [],
      complete: false,
    };
  }

  for (const seed of seeds) {
    const path = normaliseGraphPath(seed);
    if (!isTraversable(path)) continue;
    await walk(state, path);
    if (!state.complete) break;
  }

  // The target's own directory is watched whole by the caller, so listing it as
  // opaque says nothing; only a dependency the walk could not follow matters.
  const opaqueWorkspaces = [...state.opaque]
    .filter((path) => path !== rootDirectory)
    .sort();
  const files = [...state.reached]
    .filter(
      (path) =>
        !pathIsInside(path, rootDirectory) &&
        !opaqueWorkspaces.some((workspace) => pathIsInside(path, workspace)),
    )
    .sort();

  return {
    sha: options.sha,
    rootDirectory,
    files,
    opaqueWorkspaces,
    complete: state.complete,
  };
}

/**
 * Whether a changed file is one the graph says the target reads.
 *
 * Only ever consulted for a file the coarse matcher already placed inside a
 * dependency workspace, so "not reached" here means the target imports the
 * package but not this file — a test, a sibling schema, a script.
 */
export function graphReaches(graph: ModuleGraph, changedFile: string): boolean {
  const path = normaliseGraphPath(changedFile);
  if (pathIsInside(path, graph.rootDirectory)) return true;
  if (
    graph.opaqueWorkspaces.some((workspace) => pathIsInside(path, workspace))
  ) {
    return true;
  }
  if (graph.files.includes(path)) return true;

  // A file the walk never opened still decides the build when it is what the
  // package manager, the compiler or the bundler reads: adding a dependency,
  // repointing an export, changing a compiler target. Only source files the
  // graph provably does not reach are safe to ignore; assets, styles and
  // generated data in a dependency are left to rebuild.
  return !isTraversable(path);
}
