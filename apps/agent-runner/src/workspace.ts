import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  type ClaimedRun,
  claimedRunSchema,
  type RunResult,
  runResultSchema,
} from "@repo/schemas";
import { z } from "zod";
import { freeBytes } from "./admission";
import type { RunnerConfig } from "./config";
import type { ContainerSpec, Docker, Mount } from "./docker";
import type { CommandRunner } from "./exec";
import type { Logger } from "./log";
import { resolvConf } from "./network";

/** The image's non-root user. Every file a run writes is owned by it. */
export const CONTAINER_USER = "1000:1000";
const CONTAINER_UID = 1000;
export const WORKSPACE_RETENTION_MS = 24 * 60 * 60_000;
const MAX_RESULT_BYTES = 1024 * 1024;

export interface RunPaths {
  runId: string;
  mirror: string;
  worktree: string;
  out: string;
  context: string;
  sprintMd: string;
  findings: string;
  result: string;
  stream: string;
  state: string;
  envFile: string;
}

/**
 * Worktrees and mirrors are mounted at their host paths: a worktree's `.git`
 * names its gitdir inside the mirror by absolute path, and that path has to
 * resolve in every container that touches it.
 */
export function runPaths(
  root: string,
  run: Pick<ClaimedRun, "runId" | "sprint">,
): RunPaths {
  const [owner, name] = run.sprint.repo.split("/");
  const out = join(root, "runs", `${run.runId}-out`);
  return {
    runId: run.runId,
    mirror: join(root, "mirrors", owner ?? "_", `${name ?? "_"}.git`),
    worktree: join(root, "runs", run.runId),
    out,
    context: join(out, "context"),
    sprintMd: join(out, "context", "SPRINT.md"),
    findings: join(out, "context", "findings.json"),
    result: join(out, "result.json"),
    stream: join(out, "stream.jsonl"),
    state: join(root, "state", `${run.runId}.json`),
    envFile: join(root, "state", `${run.runId}.env`),
  };
}

/** As the run container sees `out`. */
export const CONTAINER_OUT = "/out";
export const CONTAINER_CREDS = "/run/creds";

// ── Runner-side state per run ──────────────────────────────────────────────

export const runStateSchema = z.object({
  run: claimedRunSchema,
  containerName: z.string(),
  credsDir: z.string(),
  startedAt: z.number(),
  deadline: z.number(),
  git: z
    .object({
      head: z.string(),
      mergeBase: z.string(),
      baseTip: z.string(),
    })
    .optional(),
  /** Steps after the container that must not happen twice on a re-attach. */
  milestones: z
    .object({
      pushed: z.boolean().optional(),
      prNumber: z.number().optional(),
      prUrl: z.string().optional(),
      rowAppended: z.boolean().optional(),
      reviewPosted: z.boolean().optional(),
      readyMarked: z.boolean().optional(),
    })
    .default({}),
  completedAt: z.number().optional(),
  removeNow: z.boolean().optional(),
});
export type RunState = z.infer<typeof runStateSchema>;

export async function readRunState(path: string): Promise<RunState | null> {
  try {
    return runStateSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

export async function writeRunState(
  path: string,
  state: RunState,
): Promise<void> {
  const temporary = `${path}.next`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, path);
}

// ── Result ─────────────────────────────────────────────────────────────────

export type ResultRead =
  | { ok: true; result: RunResult }
  | { ok: false; reason: string };

export async function readResult(
  path: string,
  kind: ClaimedRun["slot"]["kind"],
): Promise<ResultRead> {
  let raw: string;
  try {
    const info = await stat(path);
    if (!info.isFile())
      return { ok: false, reason: "result.json is not a file" };
    if (info.size > MAX_RESULT_BYTES) {
      return { ok: false, reason: "result.json is larger than 1 MB" };
    }
    raw = await readFile(path, "utf8");
  } catch {
    return { ok: false, reason: "The agent wrote no result.json" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "result.json is not JSON" };
  }
  const parsed = runResultSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, reason: `result.json is invalid: ${detail}` };
  }
  if (parsed.data.kind !== kind) {
    return {
      ok: false,
      reason: `result.json is a ${parsed.data.kind} result for a ${kind} run`,
    };
  }
  return { ok: true, result: parsed.data };
}

// ── Workspaces ─────────────────────────────────────────────────────────────

export class WorkspaceError extends Error {}

export interface PreparedWorkspace {
  head: string;
  baseTip: string;
  mergeBase: string;
  created: boolean;
}

export interface FinalizeOutcome {
  head: string;
  committed: boolean;
  ahead: number;
  push: "ok" | "rejected" | "skipped";
  pushError?: string;
}

const prepareOutputSchema = z.object({
  head: z.string().regex(/^[a-f0-9]{40}$/),
  baseTip: z.string().regex(/^[a-f0-9]{40}$/),
  mergeBase: z.string().regex(/^[a-f0-9]{40}$/),
  created: z.boolean(),
});

const finalizeOutputSchema = z.object({
  head: z.string().regex(/^[a-f0-9]{40}$/),
  committed: z.boolean(),
  ahead: z.number().int(),
  push: z.enum(["ok", "rejected", "skipped"]),
});

const PREPARE_SCRIPT = `set -eu
if [ ! -f "$MIRROR/HEAD" ]; then
  git init --bare --quiet "$MIRROR"
  git -C "$MIRROR" remote add origin "$REPO_URL"
  git -C "$MIRROR" config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
fi
git -C "$MIRROR" config gc.auto 0
git -C "$MIRROR" fetch --prune --quiet origin
if git -C "$MIRROR" rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null; then
  start="refs/remotes/origin/$BRANCH"; created=false
else
  start="refs/remotes/origin/$BASE"; created=true
fi
git -C "$MIRROR" worktree add --quiet --force -B "$BRANCH" "$WORKTREE" "$start"
head=$(git -C "$WORKTREE" rev-parse HEAD)
base_tip=$(git -C "$MIRROR" rev-parse "refs/remotes/origin/$BASE")
merge_base=$(git -C "$WORKTREE" merge-base HEAD "$base_tip")
printf '{"head":"%s","baseTip":"%s","mergeBase":"%s","created":%s}\\n' "$head" "$base_tip" "$merge_base" "$created"
`;

/**
 * Hooks and fsmonitor are off because the agent could write either into the
 * mirror, and this runs as the runner's step, not the agent's.
 */
const FINALIZE_SCRIPT = `set -u
cd "$WORKTREE"
g() { git -c core.hooksPath=/dev/null -c core.fsmonitor=false "$@"; }
committed=false
if [ "$COMMIT" = 1 ] && [ -n "$(g status --porcelain)" ]; then
  g add -A && g commit --quiet --no-verify -m "chore(sprint): $SLOT_TITLE" || exit 3
  committed=true
fi
head=$(g rev-parse HEAD) || exit 3
ahead=$(g rev-list --count "refs/remotes/origin/$BASE..HEAD") || exit 3
push=skipped
if [ "$PUSH" = 1 ]; then
  if g push --quiet origin "HEAD:refs/heads/$BRANCH" 2>/tmp/push.err; then push=ok; else push=rejected; fi
fi
printf '{"head":"%s","committed":%s,"ahead":%s,"push":"%s"}\\n' "$head" "$committed" "$ahead" "$push"
if [ "$push" = rejected ]; then cat /tmp/push.err >&2; fi
`;

const GC_SCRIPT = 'set -eu\nfor target in "$@"; do rm -rf -- "$target"; done\n';

/** Host uid of the container's uid 1000 under the rootless daemon. */
export function mappedUid(subuid: string, user: string): number | null {
  for (const line of subuid.split("\n")) {
    const [name, start] = line.trim().split(":");
    if (name === user && start) return Number(start) + CONTAINER_UID - 1;
  }
  return null;
}

export class Workspaces {
  readonly #repoLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: Pick<
      RunnerConfig,
      | "root"
      | "image"
      | "containerRuntime"
      | "network"
      | "git"
      | "minFreeDiskBytes"
      | "dns"
    >,
    private readonly docker: Pick<Docker, "runOnce">,
    private readonly exec: CommandRunner,
    private readonly hostUid: number,
    private readonly log: Logger,
  ) {}

  /**
   * Directories the container's user writes into. They are handed to that
   * user (its host subuid) rather than opened by ACL alone: gVisor checks mode
   * bits and never reads an ACL, so under runsc an ACL grant is no grant at
   * all. The runner keeps its own access through an ACL entry, which the host
   * kernel does honour. Setting the ACL needs ownership, so it comes first;
   * the chown needs CAP_CHOWN, so a runc helper does it as namespace root.
   */
  async #shared(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o755 });
    if ((await stat(path)).uid === this.hostUid) return;
    const self = process.getuid?.();
    if (self === undefined) throw new WorkspaceError("no process uid");
    const acl = await this.exec([
      "setfacl",
      "-m",
      `u:${this.hostUid}:rwx,u:${self}:rwx`,
      path,
    ]);
    if (acl.exitCode !== 0) {
      throw new WorkspaceError(`setfacl on ${path}: ${acl.stderr.trim()}`);
    }
    const owned = await this.docker.runOnce(
      {
        image: this.config.image,
        runtime: "runc",
        network: "none",
        user: "0:0",
        readOnly: true,
        mounts: [{ source: path, target: path }],
        entrypoint: "chown",
        command: [CONTAINER_USER, path],
      },
      { timeoutMs: 2 * 60_000 },
    );
    if (owned.exitCode !== 0) {
      throw new WorkspaceError(`chown of ${path}: ${owned.stderr.trim()}`);
    }
  }

  async bootstrap(): Promise<void> {
    const { root } = this.config;
    await mkdir(root, { recursive: true, mode: 0o711 });
    await chmod(root, 0o711);
    for (const dir of ["runs", "mirrors"]) await this.#shared(join(root, dir));
    await this.#shared(join(root, "cache", "bun"));
    await mkdir(join(root, "state"), { recursive: true, mode: 0o700 });
    await mkdir(join(root, "creds"), { recursive: true, mode: 0o711 });
    await writeFile(this.resolvConfPath, resolvConf(this.config.dns), {
      mode: 0o644,
    });
    await chmod(this.resolvConfPath, 0o644);
  }

  /** Mounted over /etc/resolv.conf in every container on the run network. */
  get resolvConfPath(): string {
    return join(this.config.root, "resolv.conf");
  }

  get resolvConfMount(): Mount {
    return {
      source: this.resolvConfPath,
      target: "/etc/resolv.conf",
      readOnly: true,
    };
  }

  /** A per-run directory only someone holding its random name can reach. */
  async createCredsDir(runId: string): Promise<string> {
    const dir = join(
      this.config.root,
      "creds",
      `${runId}-${randomBytes(16).toString("hex")}`,
    );
    await mkdir(dir, { mode: 0o755 });
    return dir;
  }

  async #withRepoLock<T>(repo: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#repoLocks.get(repo) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.#repoLocks.set(repo, next);
    try {
      return await next;
    } finally {
      if (this.#repoLocks.get(repo) === next) this.#repoLocks.delete(repo);
    }
  }

  #gitSpec(
    paths: RunPaths,
    credsDir: string,
    env: Record<string, string>,
    script: string,
  ): ContainerSpec {
    const mounts: Mount[] = [
      { source: paths.mirror, target: paths.mirror },
      { source: paths.worktree, target: paths.worktree },
      { source: credsDir, target: CONTAINER_CREDS, readOnly: true },
      this.resolvConfMount,
    ];
    return {
      image: this.config.image,
      runtime: this.config.containerRuntime,
      network: this.config.network,
      user: CONTAINER_USER,
      memory: "2g",
      memorySwap: "2g",
      cpus: 2,
      pidsLimit: 512,
      readOnly: true,
      tmpfs: ["/tmp:rw,nosuid,size=256m"],
      mounts,
      env: {
        HOME: "/tmp/home",
        GIT_TERMINAL_PROMPT: "0",
        ...env,
      },
      entrypoint: "sh",
      command: ["-c", script],
    };
  }

  async prepare(
    run: ClaimedRun,
    paths: RunPaths,
    credsDir: string,
  ): Promise<PreparedWorkspace> {
    const free = await freeBytes(this.config.root);
    if (free < this.config.minFreeDiskBytes) {
      throw new WorkspaceError(
        `Only ${(free / 1024 ** 3).toFixed(1)} GB free under ${this.config.root}`,
      );
    }
    await this.#shared(paths.mirror);
    await this.#shared(paths.worktree);
    await this.#shared(paths.out);
    await mkdir(paths.context, { recursive: true, mode: 0o755 });
    return this.#withRepoLock(run.sprint.repo, async () => {
      const result = await this.docker.runOnce(
        this.#gitSpec(
          paths,
          credsDir,
          {
            MIRROR: paths.mirror,
            WORKTREE: paths.worktree,
            BRANCH: run.sprint.branch,
            BASE: run.sprint.baseBranch,
            REPO_URL: `https://github.com/${run.sprint.repo}.git`,
          },
          PREPARE_SCRIPT,
        ),
        { timeoutMs: 20 * 60_000 },
      );
      if (result.exitCode !== 0) {
        throw new WorkspaceError(
          `Preparing the worktree failed: ${result.stderr.trim().slice(-2_000) || `exit ${result.exitCode}`}`,
        );
      }
      const line = result.stdout.trim().split("\n").at(-1) ?? "";
      let json: unknown = null;
      try {
        json = JSON.parse(line);
      } catch {
        json = null;
      }
      const parsed = prepareOutputSchema.safeParse(json);
      if (!parsed.success) {
        throw new WorkspaceError(
          `Unexpected output preparing the worktree: ${line}`,
        );
      }
      return parsed.data;
    });
  }

  async writeContext(
    run: ClaimedRun,
    paths: RunPaths,
    prepared: PreparedWorkspace,
  ): Promise<void> {
    const shas = [
      "",
      "## Git",
      "",
      `- Branch: \`${run.sprint.branch}\` (base \`${run.sprint.baseBranch}\`)`,
      `- Base tip: \`${prepared.baseTip}\``,
      `- Merge base: \`${prepared.mergeBase}\``,
      `- Head at run start: \`${prepared.head}\``,
      "",
    ].join("\n");
    await writeFile(paths.sprintMd, `${run.context.trimEnd()}\n${shas}`, {
      mode: 0o644,
    });
    await writeFile(
      paths.findings,
      `${JSON.stringify(run.findings ?? [], null, 2)}\n`,
      {
        mode: 0o644,
      },
    );
  }

  async finalize(
    run: ClaimedRun,
    paths: RunPaths,
    credsDir: string,
    options: { commit: boolean; push: boolean },
  ): Promise<FinalizeOutcome> {
    return this.#withRepoLock(run.sprint.repo, async () => {
      const result = await this.docker.runOnce(
        this.#gitSpec(
          paths,
          credsDir,
          {
            WORKTREE: paths.worktree,
            BRANCH: run.sprint.branch,
            BASE: run.sprint.baseBranch,
            SLOT_TITLE: run.slot.title,
            COMMIT: options.commit ? "1" : "0",
            PUSH: options.push ? "1" : "0",
            GIT_AUTHOR_NAME: this.config.git.name,
            GIT_AUTHOR_EMAIL: this.config.git.email,
            GIT_COMMITTER_NAME: this.config.git.name,
            GIT_COMMITTER_EMAIL: this.config.git.email,
          },
          FINALIZE_SCRIPT,
        ),
        { timeoutMs: 10 * 60_000 },
      );
      const line = result.stdout.trim().split("\n").at(-1) ?? "";
      let parsed: z.infer<typeof finalizeOutputSchema> | null = null;
      try {
        parsed = finalizeOutputSchema.parse(JSON.parse(line));
      } catch {
        parsed = null;
      }
      if (result.exitCode !== 0 || !parsed) {
        throw new WorkspaceError(
          `Committing the worktree failed: ${result.stderr.trim().slice(-2_000) || `exit ${result.exitCode}`}`,
        );
      }
      return {
        ...parsed,
        pushError:
          parsed.push === "rejected"
            ? result.stderr.trim().slice(-4_000)
            : undefined,
      };
    });
  }

  /**
   * Removes runs finished more than 24 h ago (or marked for removal) that are
   * not live, then prunes worktree records from every mirror. Removal goes
   * through a runc helper as namespace root: the files belong to the
   * container's user, which the runner cannot delete as itself.
   */
  async gc(live: Set<string>, now = Date.now()): Promise<string[]> {
    const runsDir = join(this.config.root, "runs");
    const entries = await readdir(runsDir).catch(() => [] as string[]);
    const runIds = new Set(entries.map((entry) => entry.replace(/-out$/, "")));
    const removed: string[] = [];
    for (const runId of runIds) {
      if (live.has(runId)) continue;
      const statePath = join(this.config.root, "state", `${runId}.json`);
      const state = await readRunState(statePath);
      const since =
        state?.completedAt ??
        (await stat(join(runsDir, runId)).then(
          (info) => info.mtimeMs,
          () => now,
        ));
      if (!state?.removeNow && now - since < WORKSPACE_RETENTION_MS) continue;
      const ok = await this.#removeTrees([
        join(runsDir, runId),
        join(runsDir, `${runId}-out`),
      ]);
      if (!ok) continue;
      await rm(statePath, { force: true });
      await rm(join(this.config.root, "state", `${runId}.env`), {
        force: true,
      });
      if (state) await rm(state.credsDir, { recursive: true, force: true });
      removed.push(runId);
    }
    if (removed.length > 0) await this.#pruneMirrors();
    return removed;
  }

  async #removeTrees(targets: string[]): Promise<boolean> {
    const runsDir = join(this.config.root, "runs");
    const result = await this.docker.runOnce(
      {
        image: this.config.image,
        runtime: "runc",
        network: "none",
        user: "0:0",
        capAdd: ["DAC_OVERRIDE", "FOWNER"],
        readOnly: true,
        mounts: [{ source: runsDir, target: runsDir }],
        entrypoint: "sh",
        command: ["-c", GC_SCRIPT, "sh", ...targets],
      },
      { timeoutMs: 10 * 60_000 },
    );
    if (result.exitCode !== 0) {
      this.log.warn("workspace removal failed", {
        targets,
        stderr: result.stderr.slice(-500),
      });
    }
    return result.exitCode === 0;
  }

  async #pruneMirrors(): Promise<void> {
    const mirrorsDir = join(this.config.root, "mirrors");
    const owners = await readdir(mirrorsDir).catch(() => [] as string[]);
    for (const owner of owners) {
      const repos = await readdir(join(mirrorsDir, owner)).catch(
        () => [] as string[],
      );
      for (const repo of repos) {
        const mirror = join(mirrorsDir, owner, repo);
        await this.#withRepoLock(`${owner}/${repo.replace(/\.git$/, "")}`, () =>
          this.docker.runOnce(
            {
              image: this.config.image,
              runtime: this.config.containerRuntime,
              network: "none",
              user: CONTAINER_USER,
              readOnly: true,
              tmpfs: ["/tmp:rw,nosuid,size=64m"],
              mounts: [{ source: mirror, target: mirror }],
              env: { HOME: "/tmp/home" },
              entrypoint: "git",
              command: ["-C", mirror, "worktree", "prune"],
            },
            { timeoutMs: 5 * 60_000 },
          ),
        );
      }
    }
  }
}
