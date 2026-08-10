import { detectWorkspaces, type RepoInspector } from "../detect";

interface WorkspaceManifest {
  path: string;
  name: string;
  dependencies: Map<string, string>;
}

export interface ChangeAwareTarget {
  rootDirectory: string | null;
  dockerfilePath?: string | null;
}

function normalisePath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
}

function pathIsInside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
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
    const rootDirectory = normalisePath(target.rootDirectory ?? "");
    if (!rootDirectory) return true;

    const dockerfilePath = normalisePath(target.dockerfilePath ?? "");
    if (
      this.#changedFiles.some(
        (path) =>
          pathIsInside(path, rootDirectory) ||
          (dockerfilePath.length > 0 && path === dockerfilePath),
      )
    ) {
      return true;
    }

    // Anything outside the workspace declaration may control every build:
    // lockfiles, root manifests, scripts and shared configuration all live
    // here. Deploying is safer than guessing which arbitrary root file matters.
    if (
      this.#changedFiles.some(
        (path) =>
          !this.#workspacePaths.some((workspace) =>
            pathIsInside(path, workspace),
          ),
      )
    ) {
      return true;
    }

    const owner = this.#workspacePaths.find((workspace) =>
      pathIsInside(rootDirectory, workspace),
    );
    if (!owner) return false;
    if (!this.#workspaceGraphComplete) return true;

    const watched = this.#dependencyClosure(owner);
    // An unreadable manifest or unresolved `workspace:` dependency means the
    // graph cannot prove the change is unrelated. Fail open and build.
    if (!watched) return true;
    return this.#changedFiles.some((path) =>
      [...watched].some((workspace) => pathIsInside(path, workspace)),
    );
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
