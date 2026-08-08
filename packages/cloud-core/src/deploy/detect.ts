import {
  DEPLOY_NODE_VERSIONS,
  type DeployBuilder,
  type DeployNodeVersion,
} from "@repo/schemas/cloud";

/**
 * The slice of a repository detection needs. Backed by the GitHub Contents
 * API in production and by a plain object in tests — detection never talks to
 * GitHub itself, which is what makes the framework table testable without a
 * network or an installation.
 */
export interface RepoInspector {
  readFile(path: string): Promise<string | null>;
  listDirectory(path: string): Promise<DetectDirEntry[] | null>;
}

export interface DetectDirEntry {
  name: string;
  type: "file" | "dir";
}

export interface DetectedBuildConfig {
  framework: string;
  frameworkLabel: string;
  builder: DeployBuilder;
  dockerfilePath: string | null;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  nodeVersion: DeployNodeVersion | null;
  healthPath: string;
}

export const UNKNOWN_FRAMEWORK: DetectedBuildConfig = {
  framework: "unknown",
  frameworkLabel: "Unknown",
  builder: "auto",
  dockerfilePath: null,
  installCommand: null,
  buildCommand: null,
  startCommand: null,
  nodeVersion: null,
  healthPath: "/",
};

// Derived rather than written out, so adding a version to the list is the only
// edit needed. Reducing without a seed keeps the element type.
const NEWEST_NODE: DeployNodeVersion = DEPLOY_NODE_VERSIONS.reduce(
  (newest, version) => (Number(version) > Number(newest) ? version : newest),
);
const DEFAULT_NODE: DeployNodeVersion = "22";

/**
 * A version this platform can actually build, chosen from what the repository
 * asks for.
 *
 * Never returns null for a Node project, and that is the point. Leaving it to
 * nixpacks means it resolves `engines.node` to the range's lower bound — the
 * ubiquitous `">=18"` becomes exactly 18, which nixpkgs dropped at EOL, and
 * the build dies in a nix trace naming nothing the owner wrote. A range is
 * therefore read as its floor and then rounded *up* to the nearest version
 * that exists, which is what the range said it wanted anyway.
 */
function detectNodeVersion(raw: string | undefined): DeployNodeVersion {
  if (!raw) return DEFAULT_NODE;
  const major = /(\d+)/.exec(raw)?.[1];
  if (!major) return DEFAULT_NODE;
  const wanted = Number(major);
  const exact = DEPLOY_NODE_VERSIONS.find(
    (version) => Number(version) === wanted,
  );
  // An exact pin is honoured when it is offered at all. Anything older than
  // the oldest supported version rounds up rather than failing here: a repo
  // pinned to a Node that no longer exists still has to build somehow, and
  // saying so in the form beats a nix trace at minute one.
  if (exact) return exact;
  return (
    DEPLOY_NODE_VERSIONS.find((version) => Number(version) >= wanted) ??
    NEWEST_NODE
  );
}

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

interface PackageManagerCommands {
  install: string;
  run: (script: string) => string;
  exec: (command: string) => string;
}

const PACKAGE_MANAGERS: Record<PackageManager, PackageManagerCommands> = {
  bun: {
    install: "bun install",
    run: (script) => `bun run ${script}`,
    exec: (command) => `bunx --bun ${command}`,
  },
  pnpm: {
    install: "pnpm install --frozen-lockfile",
    run: (script) => `pnpm run ${script}`,
    exec: (command) => `pnpm exec ${command}`,
  },
  yarn: {
    install: "yarn install --immutable",
    run: (script) => `yarn ${script}`,
    exec: (command) => `yarn ${command}`,
  },
  npm: {
    install: "npm ci",
    run: (script) => `npm run ${script}`,
    exec: (command) => `npx --yes ${command}`,
  },
};

const LOCKFILES: Array<[string, PackageManager]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

interface PackageJson {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  enginesNode: string | undefined;
}

/**
 * A workspace's own lockfile is the exception, not the rule: in a monorepo the
 * lockfile sits at the repository root while the app being deployed is three
 * directories down. Detection therefore looks in the selected directory first
 * and falls back to the root, which is also the directory nixpacks installs
 * from.
 */
async function detectPackageManager(
  repo: RepoInspector,
  dir: string,
): Promise<PackageManager> {
  for (const location of dir ? [dir, ""] : [""]) {
    const entries = await repo.listDirectory(location);
    if (!entries) continue;
    const names = new Set(
      entries.filter((entry) => entry.type === "file").map((e) => e.name),
    );
    for (const [lockfile, manager] of LOCKFILES) {
      if (names.has(lockfile)) return manager;
    }
  }
  return "npm";
}

function readPackageJson(raw: string | null): PackageJson | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const pkg = parsed as Record<string, unknown>;
  const stringMap = (value: unknown): Record<string, string> => {
    if (value === null || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as const] : [],
      ),
    );
  };
  return {
    scripts: stringMap(pkg.scripts),
    dependencies: {
      ...stringMap(pkg.dependencies),
      ...stringMap(pkg.devDependencies),
    },
    enginesNode: stringMap(pkg.engines).node,
  };
}

function joinPath(dir: string, name: string): string {
  const clean = dir.replace(/^\/+|\/+$/g, "");
  return clean ? `${clean}/${name}` : name;
}

/**
 * Static output is served by fetching `serve` at container start rather than
 * baking it in: the alternatives are mutating the lockfile during install or
 * shipping a second builder, and this costs one npx download per start on a
 * command the owner can overwrite.
 */
function serveStatic(directory: string): string {
  return `npx --yes serve -s ${directory} -l \${PORT:-3000}`;
}

interface NodeFramework {
  framework: string;
  label: string;
  /** First match wins, so the order of the table is the precedence. */
  matches: (pkg: PackageJson) => boolean;
  build: (pkg: PackageJson, pm: PackageManagerCommands) => string | null;
  start: (pkg: PackageJson, pm: PackageManagerCommands) => string | null;
}

const has = (pkg: PackageJson, ...names: string[]): boolean =>
  names.some((name) => name in pkg.dependencies);

/** The declared script when there is one, since it may carry flags we cannot infer. */
const script = (
  pkg: PackageJson,
  pm: PackageManagerCommands,
  name: string,
): string | null => (pkg.scripts[name] ? pm.run(name) : null);

const NODE_FRAMEWORKS: NodeFramework[] = [
  {
    framework: "nextjs",
    label: "Next.js",
    matches: (pkg) => has(pkg, "next"),
    build: (pkg, pm) => script(pkg, pm, "build") ?? pm.exec("next build"),
    start: (pkg, pm) => script(pkg, pm, "start") ?? pm.exec("next start"),
  },
  {
    framework: "nuxt",
    label: "Nuxt",
    matches: (pkg) => has(pkg, "nuxt", "nuxt3"),
    build: (pkg, pm) => script(pkg, pm, "build") ?? pm.exec("nuxt build"),
    start: () => "node .output/server/index.mjs",
  },
  {
    framework: "sveltekit",
    label: "SvelteKit",
    matches: (pkg) => has(pkg, "@sveltejs/kit"),
    build: (pkg, pm) => script(pkg, pm, "build") ?? pm.exec("vite build"),
    // adapter-node's output. A project on adapter-auto or adapter-static
    // builds fine and then has nothing to run, which is a real failure mode
    // worth seeing as a start-command error rather than a silent static serve.
    start: () => "node build",
  },
  {
    framework: "remix",
    label: "Remix / React Router",
    matches: (pkg) =>
      has(pkg, "@remix-run/serve", "@remix-run/node", "@react-router/serve"),
    build: (pkg, pm) =>
      script(pkg, pm, "build") ?? pm.exec("react-router build"),
    start: (pkg, pm) =>
      has(pkg, "@react-router/serve")
        ? pm.exec("react-router-serve ./build/server/index.js")
        : pm.exec("remix-serve ./build/server/index.js"),
  },
  {
    framework: "astro",
    label: "Astro",
    matches: (pkg) => has(pkg, "astro"),
    build: (pkg, pm) => script(pkg, pm, "build") ?? pm.exec("astro build"),
    start: (pkg) =>
      has(pkg, "@astrojs/node")
        ? "node ./dist/server/entry.mjs"
        : serveStatic("dist"),
  },
  {
    framework: "nestjs",
    label: "NestJS",
    matches: (pkg) => has(pkg, "@nestjs/core"),
    build: (pkg, pm) => script(pkg, pm, "build") ?? pm.exec("nest build"),
    start: () => "node dist/main",
  },
  {
    framework: "cra",
    label: "Create React App",
    matches: (pkg) => has(pkg, "react-scripts"),
    build: (pkg, pm) => script(pkg, pm, "build") ?? pm.run("build"),
    start: () => serveStatic("build"),
  },
  {
    framework: "vite",
    label: "Vite",
    matches: (pkg) => has(pkg, "vite"),
    build: (pkg, pm) => script(pkg, pm, "build") ?? pm.exec("vite build"),
    start: () => serveStatic("dist"),
  },
  {
    framework: "node",
    label: "Node",
    matches: () => true,
    build: (pkg, pm) => script(pkg, pm, "build"),
    start: (pkg, pm) => script(pkg, pm, "start"),
  },
];

async function detectNode(
  repo: RepoInspector,
  dir: string,
  raw: string,
): Promise<DetectedBuildConfig | null> {
  const pkg = readPackageJson(raw);
  if (!pkg) return null;
  const manager = await detectPackageManager(repo, dir);
  const pm = PACKAGE_MANAGERS[manager];
  const framework =
    NODE_FRAMEWORKS.find((candidate) => candidate.matches(pkg)) ??
    NODE_FRAMEWORKS[NODE_FRAMEWORKS.length - 1];
  if (!framework) return null;
  return {
    framework: framework.framework,
    frameworkLabel: framework.label,
    builder: "nixpacks",
    dockerfilePath: null,
    installCommand: pm.install,
    buildCommand: framework.build(pkg, pm),
    startCommand: framework.start(pkg, pm),
    nodeVersion: detectNodeVersion(pkg.enginesNode),
    healthPath: "/",
  };
}

function detectPython(
  names: Set<string>,
  requirements: string | null,
  pyproject: string | null,
): DetectedBuildConfig | null {
  const manifest = `${requirements ?? ""}\n${pyproject ?? ""}`.toLowerCase();
  if (!names.has("requirements.txt") && !names.has("pyproject.toml")) {
    return null;
  }
  const install = names.has("requirements.txt")
    ? "pip install -r requirements.txt"
    : "pip install .";
  if (names.has("manage.py")) {
    return {
      framework: "django",
      frameworkLabel: "Django",
      builder: "nixpacks",
      dockerfilePath: null,
      installCommand: install,
      buildCommand: "python manage.py collectstatic --noinput",
      // The WSGI module is named after the project package, which is not
      // knowable from the file listing alone. Left unset rather than guessed:
      // a wrong module name fails at container start with an import error that
      // reads as a platform bug.
      startCommand: null,
      nodeVersion: null,
      healthPath: "/",
    };
  }
  if (manifest.includes("fastapi")) {
    return {
      framework: "fastapi",
      frameworkLabel: "FastAPI",
      builder: "nixpacks",
      dockerfilePath: null,
      installCommand: install,
      buildCommand: null,
      startCommand: "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}",
      nodeVersion: null,
      healthPath: "/",
    };
  }
  if (manifest.includes("flask")) {
    return {
      framework: "flask",
      frameworkLabel: "Flask",
      builder: "nixpacks",
      dockerfilePath: null,
      installCommand: install,
      buildCommand: null,
      startCommand: "gunicorn app:app --bind 0.0.0.0:${PORT:-3000}",
      nodeVersion: null,
      healthPath: "/",
    };
  }
  return {
    framework: "python",
    frameworkLabel: "Python",
    builder: "nixpacks",
    dockerfilePath: null,
    installCommand: install,
    buildCommand: null,
    startCommand: null,
    nodeVersion: null,
    healthPath: "/",
  };
}

/**
 * Detects what to build in `dir` (repository-relative, "" for the root).
 *
 * A Dockerfile wins over everything: it is an explicit statement of how the
 * project builds, and the agent refuses install and build commands on that
 * path anyway. Everything else resolves to nixpacks with materialised
 * commands — the UI shows exactly what will run rather than a blank field and
 * whatever nixpacks decides at build time.
 */
export async function detectBuildConfig(
  repo: RepoInspector,
  dir = "",
): Promise<DetectedBuildConfig> {
  const entries = await repo.listDirectory(dir);
  if (!entries) return UNKNOWN_FRAMEWORK;
  const names = new Set(
    entries.filter((entry) => entry.type === "file").map((e) => e.name),
  );

  if (names.has("Dockerfile")) {
    return {
      framework: "dockerfile",
      frameworkLabel: "Dockerfile",
      builder: "dockerfile",
      dockerfilePath: joinPath(dir, "Dockerfile"),
      installCommand: null,
      buildCommand: null,
      startCommand: null,
      nodeVersion: null,
      healthPath: "/",
    };
  }

  if (names.has("package.json")) {
    const raw = await repo.readFile(joinPath(dir, "package.json"));
    const detected = raw ? await detectNode(repo, dir, raw) : null;
    if (detected) return detected;
  }

  const python = detectPython(
    names,
    names.has("requirements.txt")
      ? await repo.readFile(joinPath(dir, "requirements.txt"))
      : null,
    names.has("pyproject.toml")
      ? await repo.readFile(joinPath(dir, "pyproject.toml"))
      : null,
  );
  if (python) return python;

  if (names.has("go.mod")) {
    return {
      ...UNKNOWN_FRAMEWORK,
      framework: "go",
      frameworkLabel: "Go",
      builder: "nixpacks",
    };
  }
  if (names.has("Cargo.toml")) {
    return {
      ...UNKNOWN_FRAMEWORK,
      framework: "rust",
      frameworkLabel: "Rust",
      builder: "nixpacks",
    };
  }
  if (names.has("index.html")) {
    return {
      framework: "static",
      frameworkLabel: "Static",
      builder: "nixpacks",
      dockerfilePath: null,
      installCommand: null,
      buildCommand: null,
      startCommand: serveStatic("."),
      nodeVersion: null,
      healthPath: "/",
    };
  }
  return UNKNOWN_FRAMEWORK;
}

export interface WorkspaceCandidate {
  path: string;
  name: string;
}

/** Both shapes npm and yarn accept: a bare array, or `{ packages: [...] }`. */
function readWorkspacePatterns(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object") return [];
  const workspaces = (parsed as { workspaces?: unknown }).workspaces;
  const list = Array.isArray(workspaces)
    ? workspaces
    : workspaces !== null &&
        typeof workspaces === "object" &&
        Array.isArray((workspaces as { packages?: unknown }).packages)
      ? (workspaces as { packages: unknown[] }).packages
      : [];
  return list.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Directories a monorepo declares as workspaces, so the picker can offer them
 * instead of making the owner walk the tree. Globs are resolved one level
 * deep, which is the shape every workspace declaration in practice uses
 * (`apps/*`, `packages/*`); anything deeper is still reachable by browsing.
 */
export async function detectWorkspaces(
  repo: RepoInspector,
): Promise<WorkspaceCandidate[]> {
  const patterns = new Set<string>();

  const rootPackage = await repo.readFile("package.json");
  if (rootPackage) {
    for (const entry of readWorkspacePatterns(rootPackage)) {
      patterns.add(entry);
    }
  }

  const pnpmWorkspace = await repo.readFile("pnpm-workspace.yaml");
  if (pnpmWorkspace) {
    for (const line of pnpmWorkspace.split("\n")) {
      const match = /^\s*-\s*["']?([^"'\s#]+)["']?\s*$/.exec(line);
      if (match?.[1]) patterns.add(match[1]);
    }
  }

  const found = new Map<string, WorkspaceCandidate>();
  for (const pattern of patterns) {
    const clean = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!clean || clean.includes("..")) continue;
    if (!clean.includes("*")) {
      found.set(clean, { path: clean, name: clean.split("/").pop() ?? clean });
      continue;
    }
    const base = clean.slice(0, clean.indexOf("*")).replace(/\/+$/, "");
    const entries = await repo.listDirectory(base);
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.type !== "dir") continue;
      const path = joinPath(base, entry.name);
      found.set(path, { path, name: entry.name });
    }
  }

  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}
