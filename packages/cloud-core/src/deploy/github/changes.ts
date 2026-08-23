import { detectWorkspaces, type RepoInspector } from "../detect";
import {
  graphReaches,
  type ModuleGraph,
  normaliseGraphPath as normalisePath,
  pathIsInside,
} from "../module-graph";

interface WorkspaceManifest {
  path: string;
  name: string;
  dependencies: Map<string, string>;
}

export interface ChangeAwareTarget {
  rootDirectory: string | null;
  dockerfilePath?: string | null;
  /**
   * The import graph the last build resolved for this target, when the stored
   * one still describes the current root directory. Absent means the matcher
   * falls back to watching every dependency workspace whole.
   */
  moduleGraph?: ModuleGraph | null;
}

/**
 * Why a target is or is not being built. Carried through to the GitHub check
 * run, because "skipped" with no reason is indistinguishable from a bug.
 */
export type ChangeReason =
  /** No root directory: the target owns the whole repository. */
  | "root-target"
  /** A file inside the target, or the Dockerfile it names. */
  | "own-files"
  /**
   * An input every build reads whichever target is being built: a lockfile, a
   * root manifest, the toolchain's own configuration. In the fallback matcher,
   * also any file outside every declared workspace.
   */
  | "global-inputs"
  /** A `package.json` somewhere that could not be parsed. */
  | "workspace-graph-incomplete"
  /** A dependency file the stored import graph says the target reads. */
  | "dependency-imported"
  /** A dependency changed and no import graph has been resolved yet. */
  | "dependency-unresolved"
  /** Every change landed in a workspace this target does not depend on. */
  | "unrelated-workspace"
  /** Nothing that changed is a file the resolved import graph says it reads. */
  | "unimported-files";

export interface ChangeDecision {
  deploy: boolean;
  reason: ChangeReason;
  /**
   * The changed files that decided it, capped for display. Empty for a
   * `deploy: false` decision, where the interesting set is everything.
   */
  files: string[];
}

const DECIDING_FILE_SAMPLE = 5;

/**
 * Repository-root files every build reads through the package manager or the
 * toolchain, whichever target is being built.
 *
 * Deliberately not a list of paths that look important. Each of these changes
 * what `bun install` resolves or what runs the build, which no import graph can
 * observe — as opposed to documentation, CI workflows or infrastructure, which
 * the graph can be asked about like anything else and answers "nothing reads
 * this" for.
 */
const TOOLCHAIN_ROOT_INPUTS: ReadonlySet<string> = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package.json",
  "turbo.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "nixpacks.toml",
  ".npmrc",
  ".dockerignore",
  ".node-version",
  ".nvmrc",
  ".tool-versions",
]);

function isToolchainRootInput(path: string): boolean {
  return !path.includes("/") && TOOLCHAIN_ROOT_INPUTS.has(path);
}

function build(reason: ChangeReason, files: string[]): ChangeDecision {
  return { deploy: true, reason, files: files.slice(0, DECIDING_FILE_SAMPLE) };
}

function skip(reason: ChangeReason): ChangeDecision {
  return { deploy: false, reason, files: [] };
}

function readManifest(
  path: string,
  raw: string | null,
): WorkspaceManifest | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const pkg = value as Record<string, unknown>;
  if (typeof pkg.name !== "string" || pkg.name.length === 0) return null;

  const dependencies = new Map<string, string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const entries = pkg[field];
    if (entries === null || typeof entries !== "object") continue;
    for (const [name, version] of Object.entries(entries)) {
      if (typeof version === "string") dependencies.set(name, version);
    }
  }
  return { path, name: pkg.name, dependencies };
}

/**
 * Answers whether a repository comparison can affect one deploy target.
 *
 * Files outside every declared workspace are global inputs. Files inside a
 * workspace affect that workspace and every target that depends on it. This
 * preserves the useful half of Turbo's graph without asking Turbo whether a
 * deployment should exist in the first place.
 */
export class RepositoryChangeMatcher {
  readonly #changedFiles: string[];
  readonly #workspacePaths: string[];
  readonly #leafWorkspaces: Set<string>;
  readonly #workspaceGraphComplete: boolean;
  readonly #manifestsByPath: Map<string, WorkspaceManifest>;
  readonly #manifestsByName: Map<string, WorkspaceManifest | null>;

  constructor(options: {
    changedFiles: string[];
    workspacePaths: string[];
    manifests: WorkspaceManifest[];
    /**
     * Declared workspaces that hold no `package.json` at all — a Cargo, Go or
     * Python directory matched by an `apps/*` glob. They are not holes in the
     * JavaScript graph, they are simply not in it, and conflating the two made
     * every target rebuild on every push in any repository that has one.
     */
    nonPackageWorkspaces?: string[];
  }) {
    this.#changedFiles = [
      ...new Set(options.changedFiles.map(normalisePath).filter(Boolean)),
    ];
    this.#workspacePaths = options.workspacePaths
      .map(normalisePath)
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    this.#leafWorkspaces = new Set(
      (options.nonPackageWorkspaces ?? []).map(normalisePath).filter(Boolean),
    );
    // Every declared workspace has to be accounted for, either as a manifest we
    // read or as a directory we know carries none. One that is neither had a
    // `package.json` we could not parse, and that is a real hole.
    this.#workspaceGraphComplete =
      options.manifests.length + this.#leafWorkspaces.size ===
      this.#workspacePaths.length;
    this.#manifestsByPath = new Map(
      options.manifests.map((manifest) => [manifest.path, manifest]),
    );
    this.#manifestsByName = new Map();
    for (const manifest of options.manifests) {
      const existing = this.#manifestsByName.get(manifest.name);
      this.#manifestsByName.set(
        manifest.name,
        existing === undefined ? manifest : null,
      );
    }
  }

  /** A root target owns the repository, so every changed file affects it. */
  affectsTarget(target: ChangeAwareTarget): boolean {
    return this.decide(target).deploy;
  }

  decide(target: ChangeAwareTarget): ChangeDecision {
    const rootDirectory = normalisePath(target.rootDirectory ?? "");
    if (!rootDirectory) return build("root-target", this.#changedFiles);

    const dockerfilePath = normalisePath(target.dockerfilePath ?? "");
    const own = this.#changedFiles.filter(
      (path) =>
        pathIsInside(path, rootDirectory) ||
        (dockerfilePath.length > 0 && path === dockerfilePath),
    );
    if (own.length > 0) return build("own-files", own);

    const toolchain = this.#changedFiles.filter(isToolchainRootInput);
    if (toolchain.length > 0) return build("global-inputs", toolchain);

    // A resolved import graph is a better answer than any path rule, and for
    // every changed file rather than only the ones a package-level test has
    // already narrowed to a dependency. It knows what this target reads wherever
    // that lives, so a change under `docs/`, `infra/` or a sibling application
    // is decided by whether anything reaches it — and a source file that moves
    // *into* one of those directories starts mattering on its own, with nothing
    // to add to a list. Everything below is what runs when no graph exists.
    const graph = target.moduleGraph;
    if (graph?.complete && graph.rootDirectory === rootDirectory) {
      const reached = this.#changedFiles.filter((path) =>
        graphReaches(graph, path),
      );
      return reached.length > 0
        ? build("dependency-imported", reached)
        : skip("unimported-files");
    }

    // Anything outside the workspace declaration may control every build:
    // lockfiles, root manifests, scripts and shared configuration all live
    // here. Deploying is safer than guessing which arbitrary root file matters.
    const global = this.#changedFiles.filter(
      (path) =>
        !this.#workspacePaths.some((workspace) =>
          pathIsInside(path, workspace),
        ),
    );
    if (global.length > 0) return build("global-inputs", global);

    const owner = this.#workspacePaths.find((workspace) =>
      pathIsInside(rootDirectory, workspace),
    );
    if (!owner) return skip("unrelated-workspace");
    if (!this.#workspaceGraphComplete) {
      return build("workspace-graph-incomplete", this.#changedFiles);
    }

    const watched = this.#dependencyClosure(owner);
    // An unreadable manifest or unresolved `workspace:` dependency means the
    // graph cannot prove the change is unrelated. Fail open and build.
    if (!watched)
      return build("workspace-graph-incomplete", this.#changedFiles);

    const inDependencies = this.#changedFiles.filter((path) =>
      [...watched].some((workspace) => pathIsInside(path, workspace)),
    );
    if (inDependencies.length === 0) return skip("unrelated-workspace");

    // The package-level answer is "yes, this target depends on where the change
    // landed". Which is not the same as reading the file that changed: several
    // applications enter `@repo/schemas` through different subpath exports and
    // share none of the modules behind them. Only the import graph resolved
    // from a real checkout can tell those apart, and reaching here means there
    // is none to consult.
    return build("dependency-unresolved", inDependencies);
  }

  #dependencyClosure(root: string): Set<string> | null {
    const watched = new Set<string>();
    const visit = (path: string): boolean => {
      if (watched.has(path)) return true;
      watched.add(path);
      // A workspace with no manifest has no JavaScript dependencies to follow,
      // so it is a resolved leaf rather than an unreadable node. Its own files
      // are already covered by the root-directory check.
      if (this.#leafWorkspaces.has(path)) return true;
      const manifest = this.#manifestsByPath.get(path);
      if (!manifest) return false;

      for (const [name, version] of manifest.dependencies) {
        const dependency = this.#manifestsByName.get(name);
        if (dependency === null) return false;
        if (dependency) {
          if (!visit(dependency.path)) return false;
          continue;
        }
        if (version.startsWith("workspace:")) return false;
      }
      return true;
    };
    return visit(root) ? watched : null;
  }
}

export async function createRepositoryChangeMatcher(
  repo: RepoInspector,
  changedFiles: string[],
): Promise<RepositoryChangeMatcher> {
  const workspaces = await detectWorkspaces(repo);
  const read = await Promise.all(
    workspaces.map(async (workspace) => {
      const raw = await repo.readFile(`${workspace.path}/package.json`);
      return {
        path: workspace.path,
        absent: raw === null,
        manifest: readManifest(workspace.path, raw),
      };
    }),
  );

  return new RepositoryChangeMatcher({
    changedFiles,
    workspacePaths: workspaces.map((workspace) => workspace.path),
    manifests: read
      .map((entry) => entry.manifest)
      .filter((manifest): manifest is WorkspaceManifest => manifest !== null),
    nonPackageWorkspaces: read
      .filter((entry) => entry.absent)
      .map((entry) => entry.path),
  });
}
