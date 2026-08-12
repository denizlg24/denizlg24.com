import {
  DEFAULT_BUN_VERSION,
  DEPLOY_NODE_VERSIONS,
  type DeployBuilder,
  type DeployNodeVersion,
  type DeployPreset,
  type DeployRuntime,
  type DeployRuntimeVersion,
  isDeployRuntimeVersion,
  type RepoWorkspaceContext,
  type ResolvedBuildConfig,
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
  runtime: DeployRuntime | null;
  runtimeVersion: DeployRuntimeVersion | null;
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
  runtime: null,
  runtimeVersion: null,
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

/**
 * The lockfile decides, because it is the only signal present before anything
 * is installed. It is wrong for the repository that installs with Bun and runs
 * `node dist/index.js`, which is what the override is for.
 */
function detectRuntime(workspace: RepoWorkspaceContext): DeployRuntime {
  return workspace.packageManager === "bun" ? "bun" : "node";
}

/**
 * A Bun target is pinned rather than left unset, and that asymmetry with Node
 * is the whole point of this field. Deferring to nixpacks on Node picks a
 * plausible-but-wrong major; deferring on Bun picks 1.3.0 every time, because
 * nixpacks hardcodes one nixpkgs commit for the `bun` package and has no
 * version knob at all. Nothing about the resulting build says so.
 */
function defaultRuntimeVersion(
  runtime: DeployRuntime,
  enginesNode: string | undefined,
): DeployRuntimeVersion {
  return runtime === "bun"
    ? DEFAULT_BUN_VERSION
    : detectNodeVersion(enginesNode);
}

type PackageManager = RepoWorkspaceContext["packageManager"];

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
  name: string | null;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  enginesNode: string | undefined;
}

const EMPTY_PACKAGE: PackageJson = {
  name: null,
  scripts: {},
  dependencies: {},
  enginesNode: undefined,
};

/**
 * A workspace's own lockfile is the exception, not the rule: in a monorepo the
 * lockfile sits at the repository root while the app being deployed is three
 * directories down. Detection therefore looks in the selected directory first
 * and falls back to the root, which is also where install now runs.
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
    name: typeof pkg.name === "string" ? pkg.name : null,
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
 * Every command runs from the build context, which is the repository root —
 * see the agent's `runBuild`. A command belonging to an app three directories
 * down therefore carries its own `cd`, rather than the agent holding a second
 * notion of where things run that the form would have to mirror.
 *
 * Install is the exception and is never wrapped: in a workspace the lockfile
 * and the linked packages live at the root, which is exactly the bug this
 * split exists to fix.
 */
function inDirectory(dir: string, command: string | null): string | null {
  const clean = dir.replace(/^\/+|\/+$/g, "");
  if (!command || !clean) return command;
  return `cd ${clean} && ${command}`;
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

/**
 * What the repository is, independent of which directory was selected. Resolved
 * once and threaded through detection because every one of its answers is a
 * root-level fact — the package manager that owns the lockfile, whether turbo
 * runs the build, which directories may be selected at all.
 */
export async function detectWorkspaceContext(
  repo: RepoInspector,
): Promise<RepoWorkspaceContext> {
  const [packageManager, workspaces, turboJson] = await Promise.all([
    detectPackageManager(repo, ""),
    detectWorkspaces(repo),
    repo.readFile("turbo.json"),
  ]);
  return {
    packageManager,
    isTurbo: turboJson !== null,
    isMonorepo: workspaces.length > 0,
    workspaces,
  };
}

interface PresetContext {
  pkg: PackageJson;
  pm: PackageManagerCommands;
  /** Repository-relative directory of the app, "" for the root. */
  dir: string;
  /** File names directly in `dir`. */
  names: Set<string>;
  /** Python manifests concatenated and lowercased, for dependency sniffing. */
  manifest: string;
  workspace: RepoWorkspaceContext;
}

interface PresetOutput {
  builder: DeployBuilder;
  dockerfilePath: string | null;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  runtime: DeployRuntime | null;
  runtimeVersion: DeployRuntimeVersion | null;
  healthPath: string;
}

interface DeployPresetDefinition extends DeployPreset {
  /** First match wins, so the order of the table is the precedence. */
  matches: (context: PresetContext) => boolean;
  resolve: (context: PresetContext) => PresetOutput;
}

const has = (pkg: PackageJson, ...names: string[]): boolean =>
  names.some((name) => name in pkg.dependencies);

/** The declared script when there is one, since it may carry flags we cannot infer. */
const script = (
  pkg: PackageJson,
  pm: PackageManagerCommands,
  name: string,
): string | null => (pkg.scripts[name] ? pm.run(name) : null);

/**
 * Turbo owns the build in a repository that has it, because it is the only
 * thing that knows the app's workspace dependencies have to be built first —
 * running the app's own build script from its directory builds the app against
 * whatever stale output happens to be on disk.
 *
 * It is used only when the package declares a `build` script: `turbo run build`
 * filtered to a package with no such task exits 0 having built nothing, which
 * is a green deploy serving the previous image's output.
 */
function buildFor(
  context: PresetContext,
  fallback: string | null,
): string | null {
  const { pkg, pm, dir, workspace } = context;
  const declared = script(pkg, pm, "build");
  if (workspace.isTurbo && pkg.name && declared) {
    return pm.exec(`turbo run build --filter=${pkg.name}`);
  }
  return inDirectory(dir, declared ?? fallback);
}

function nodePreset(
  id: string,
  label: string,
  matches: (pkg: PackageJson) => boolean,
  commands: (context: PresetContext) => {
    build: string | null;
    start: string | null;
  },
): DeployPresetDefinition {
  return {
    id,
    label,
    matches: (context) =>
      context.names.has("package.json") && matches(context.pkg),
    resolve: (context) => {
      const { build, start } = commands(context);
      const runtime = detectRuntime(context.workspace);
      return {
        builder: "nixpacks",
        dockerfilePath: null,
        // Install runs at the build context root, unwrapped: in a workspace
        // the lockfile and the linked packages are both up there.
        installCommand: context.pm.install,
        buildCommand: build,
        startCommand: start,
        runtime,
        runtimeVersion: defaultRuntimeVersion(runtime, context.pkg.enginesNode),
        healthPath: "/",
      };
    },
  };
}

function pythonPreset(
  id: string,
  label: string,
  matches: (context: PresetContext) => boolean,
  commands: (context: PresetContext) => {
    build: string | null;
    start: string | null;
  },
): DeployPresetDefinition {
  return {
    id,
    label,
    matches: (context) =>
      (context.names.has("requirements.txt") ||
        context.names.has("pyproject.toml")) &&
      matches(context),
    resolve: (context) => {
      const { build, start } = commands(context);
      const install = context.names.has("requirements.txt")
        ? "pip install -r requirements.txt"
        : "pip install .";
      return {
        builder: "nixpacks",
        dockerfilePath: null,
        installCommand: inDirectory(context.dir, install),
        buildCommand: build,
        startCommand: start,
        runtime: null,
        runtimeVersion: null,
        healthPath: "/",
      };
    },
  };
}

function barePreset(
  id: string,
  label: string,
  matches: (context: PresetContext) => boolean,
  output: Partial<PresetOutput> = {},
): DeployPresetDefinition {
  return {
    id,
    label,
    matches,
    resolve: () => ({
      builder: "nixpacks",
      dockerfilePath: null,
      installCommand: null,
      buildCommand: null,
      startCommand: null,
      runtime: null,
      runtimeVersion: null,
      healthPath: "/",
      ...output,
    }),
  };
}

/**
 * Order is precedence. A Dockerfile wins over everything: it is an explicit
 * statement of how the project builds, and the agent refuses install and build
 * commands on that path anyway. Everything else resolves to nixpacks with
 * materialised commands — the form shows exactly what will run rather than a
 * blank field and whatever nixpacks decides at build time.
 */
const PRESETS: DeployPresetDefinition[] = [
  {
    id: "dockerfile",
    label: "Dockerfile",
    matches: (context) => context.names.has("Dockerfile"),
    resolve: (context) => ({
      builder: "dockerfile",
      // Repository-relative, because the build context is the repository root
      // and `docker build --file` is resolved against it.
      dockerfilePath: joinPath(context.dir, "Dockerfile"),
      installCommand: null,
      buildCommand: null,
      startCommand: null,
      runtime: null,
      runtimeVersion: null,
      healthPath: "/",
    }),
  },
  nodePreset(
    "nextjs",
    "Next.js",
    (pkg) => has(pkg, "next"),
    (context) => ({
      build: buildFor(context, context.pm.exec("next build")),
      start: inDirectory(
        context.dir,
        script(context.pkg, context.pm, "start") ??
          context.pm.exec("next start"),
      ),
    }),
  ),
  nodePreset(
    "nuxt",
    "Nuxt",
    (pkg) => has(pkg, "nuxt", "nuxt3"),
    (context) => ({
      build: buildFor(context, context.pm.exec("nuxt build")),
      start: inDirectory(context.dir, "node .output/server/index.mjs"),
    }),
  ),
  nodePreset(
    "sveltekit",
    "SvelteKit",
    (pkg) => has(pkg, "@sveltejs/kit"),
    (context) => ({
      build: buildFor(context, context.pm.exec("vite build")),
      // adapter-node's output. A project on adapter-auto or adapter-static
      // builds fine and then has nothing to run, which is a real failure mode
      // worth seeing as a start-command error rather than a silent static serve.
      start: inDirectory(context.dir, "node build"),
    }),
  ),
  nodePreset(
    "remix",
    "Remix / React Router",
    (pkg) =>
      has(pkg, "@remix-run/serve", "@remix-run/node", "@react-router/serve"),
    (context) => ({
      build: buildFor(context, context.pm.exec("react-router build")),
      start: inDirectory(
        context.dir,
        has(context.pkg, "@react-router/serve")
          ? context.pm.exec("react-router-serve ./build/server/index.js")
          : context.pm.exec("remix-serve ./build/server/index.js"),
      ),
    }),
  ),
  nodePreset(
    "astro",
    "Astro",
    (pkg) => has(pkg, "astro"),
    (context) => ({
      build: buildFor(context, context.pm.exec("astro build")),
      start: inDirectory(
        context.dir,
        has(context.pkg, "@astrojs/node")
          ? "node ./dist/server/entry.mjs"
          : serveStatic("dist"),
      ),
    }),
  ),
  nodePreset(
    "nestjs",
    "NestJS",
    (pkg) => has(pkg, "@nestjs/core"),
    (context) => ({
      build: buildFor(context, context.pm.exec("nest build")),
      start: inDirectory(context.dir, "node dist/main"),
    }),
  ),
  nodePreset(
    "hono",
    "Hono",
    (pkg) => has(pkg, "hono"),
    (context) => ({
      // Hono is a library, not a scaffold: it declares no conventional entry
      // point and no output directory. Only what the repository states is
      // usable, so an undeclared script is left unset rather than guessed.
      build: buildFor(context, null),
      start: inDirectory(context.dir, script(context.pkg, context.pm, "start")),
    }),
  ),
  nodePreset(
    "cra",
    "Create React App",
    (pkg) => has(pkg, "react-scripts"),
    (context) => ({
      build: buildFor(context, context.pm.run("build")),
      start: inDirectory(context.dir, serveStatic("build")),
    }),
  ),
  nodePreset(
    "vite",
    "Vite",
    (pkg) => has(pkg, "vite"),
    (context) => ({
      build: buildFor(context, context.pm.exec("vite build")),
      start: inDirectory(context.dir, serveStatic("dist")),
    }),
  ),
  nodePreset(
    "node",
    "Node",
    () => true,
    (context) => ({
      build: buildFor(context, null),
      start: inDirectory(context.dir, script(context.pkg, context.pm, "start")),
    }),
  ),
  pythonPreset(
    "django",
    "Django",
    (context) => context.names.has("manage.py"),
    (context) => ({
      build: inDirectory(
        context.dir,
        "python manage.py collectstatic --noinput",
      ),
      // The WSGI module is named after the project package, which is not
      // knowable from the file listing alone. Left unset rather than guessed:
      // a wrong module name fails at container start with an import error that
      // reads as a platform bug.
      start: null,
    }),
  ),
  pythonPreset(
    "fastapi",
    "FastAPI",
    (context) => context.manifest.includes("fastapi"),
    (context) => ({
      build: null,
      start: inDirectory(
        context.dir,
        "uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}",
      ),
    }),
  ),
  pythonPreset(
    "flask",
    "Flask",
    (context) => context.manifest.includes("flask"),
    (context) => ({
      build: null,
      start: inDirectory(
        context.dir,
        "gunicorn app:app --bind 0.0.0.0:${PORT:-3000}",
      ),
    }),
  ),
  pythonPreset(
    "python",
    "Python",
    () => true,
    () => ({ build: null, start: null }),
  ),
  barePreset("go", "Go", (context) => context.names.has("go.mod")),
  barePreset("rust", "Rust", (context) => context.names.has("Cargo.toml")),
  barePreset("static", "Static", (context) => context.names.has("index.html"), {
    startCommand: serveStatic("."),
  }),
];

/** Offered by the import form's preset picker, in the table's own precedence. */
export const DEPLOY_PRESETS: DeployPreset[] = PRESETS.map(({ id, label }) => ({
  id,
  label,
}));

async function presetContext(
  repo: RepoInspector,
  dir: string,
  workspace: RepoWorkspaceContext,
): Promise<PresetContext | null> {
  const entries = await repo.listDirectory(dir);
  if (!entries) return null;
  const names = new Set(
    entries.filter((entry) => entry.type === "file").map((e) => e.name),
  );

  const pkg = names.has("package.json")
    ? readPackageJson(await repo.readFile(joinPath(dir, "package.json")))
    : null;

  const manifest = (
    await Promise.all(
      ["requirements.txt", "pyproject.toml"]
        .filter((name) => names.has(name))
        .map((name) => repo.readFile(joinPath(dir, name))),
    )
  )
    .join("\n")
    .toLowerCase();

  return {
    pkg: pkg ?? EMPTY_PACKAGE,
    // Resolved against the selected directory, falling back to the root — the
    // lockfile that governs the install is usually the root one.
    pm: PACKAGE_MANAGERS[await detectPackageManager(repo, dir)],
    dir,
    names,
    manifest,
    workspace,
  };
}

/**
 * Detects what to build in `dir` (repository-relative, "" for the root).
 *
 * Pass `framework` to force a preset instead of matching one, which is what the
 * form's preset picker does — a repository whose dependencies do not say what
 * it is still has to be deployable.
 */
export async function detectBuildConfig(
  repo: RepoInspector,
  dir = "",
  options: {
    framework?: string | null;
    workspace?: RepoWorkspaceContext;
  } = {},
): Promise<DetectedBuildConfig> {
  const workspace = options.workspace ?? (await detectWorkspaceContext(repo));
  const context = await presetContext(repo, dir, workspace);
  if (!context) return UNKNOWN_FRAMEWORK;

  const forced = options.framework
    ? PRESETS.find((preset) => preset.id === options.framework)
    : null;
  const preset = forced ?? PRESETS.find((entry) => entry.matches(context));
  if (!preset) return UNKNOWN_FRAMEWORK;

  return {
    framework: preset.id,
    frameworkLabel: preset.label,
    ...preset.resolve(context),
  };
}

/** Null and empty string both mean "the preset decides". */
export interface BuildConfigOverrides {
  builder?: DeployBuilder | null;
  dockerfilePath?: string | null;
  installCommand?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  runtime?: DeployRuntime | null;
  runtimeVersion?: DeployRuntimeVersion | null;
  healthPath?: string | null;
}

function overlay<T>(
  preset: T,
  override: T | null | undefined,
): { value: T; source: "preset" | "override" } {
  return override === null || override === undefined
    ? { value: preset, source: "preset" }
    : { value: override, source: "override" };
}

/**
 * What will actually run, with the preset's answer kept visible beside any
 * override that replaced it.
 *
 * The import form and the enqueue path both call this, and that is the point:
 * resolving separately is how a form ends up showing commands that are not the
 * ones the build executes.
 */
export async function resolveBuildConfig(
  repo: RepoInspector,
  options: {
    rootDirectory?: string | null;
    framework?: string | null;
    overrides?: BuildConfigOverrides;
    workspace?: RepoWorkspaceContext;
  } = {},
): Promise<ResolvedBuildConfig> {
  const detected = await detectBuildConfig(repo, options.rootDirectory ?? "", {
    framework: options.framework,
    workspace: options.workspace,
  });
  const overrides = options.overrides ?? {};

  // "auto" is the absence of a choice, not a choice of auto — it is the column
  // default every target starts with, so treating it as an override would pin
  // every target to whatever the builder resolved on its first import.
  const builder =
    overrides.builder && overrides.builder !== "auto"
      ? overrides.builder
      : null;

  const runtime = overlay(detected.runtime, overrides.runtime);
  // A version belongs to a runtime, and the runtime can be overridden out from
  // under it. Switching a target from Node to Bun leaves `"22"` in a column
  // that now has to mean a Bun version, and detection's own answer is stale in
  // exactly the same way. Either is replaced by the new runtime's default
  // rather than carried across — for Bun that default is a real version, where
  // dropping to null would hand the build back to nixpacks and its hardcoded
  // 1.3.0.
  const presetVersion =
    runtime.value === null
      ? null
      : isDeployRuntimeVersion(runtime.value, detected.runtimeVersion)
        ? detected.runtimeVersion
        : defaultRuntimeVersion(runtime.value, undefined);
  const runtimeVersion = overlay(
    presetVersion,
    isDeployRuntimeVersion(runtime.value, overrides.runtimeVersion)
      ? overrides.runtimeVersion
      : null,
  );

  return {
    framework: detected.framework,
    frameworkLabel: detected.frameworkLabel,
    builder: overlay(detected.builder, builder),
    dockerfilePath: overlay(detected.dockerfilePath, overrides.dockerfilePath),
    installCommand: overlay(detected.installCommand, overrides.installCommand),
    buildCommand: overlay(detected.buildCommand, overrides.buildCommand),
    startCommand: overlay(detected.startCommand, overrides.startCommand),
    runtime,
    runtimeVersion,
    healthPath: overlay(detected.healthPath, overrides.healthPath),
  };
}
