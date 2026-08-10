import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import {
  collectGraphWorkspaces,
  type ModuleGraphFs,
  type RepoInspector,
  resolveModuleGraph,
  SKIPPED_DIRECTORIES,
} from "@repo/cloud-core/deploy";
import type { DeployModuleGraph } from "@repo/schemas/cloud";

import type { BuildLog } from "./build-log";

/** Refuses to read anything a source file could not plausibly be. */
const MAX_SOURCE_BYTES = 2_000_000;

/**
 * The checkout, in the shape the resolver and workspace detection expect. Paths
 * crossing this boundary are repository-relative and POSIX-separated on every
 * platform, because that is what a GitHub comparison reports and what the
 * control plane later matches against.
 */
export function createCheckoutFs(root: string): ModuleGraphFs & RepoInspector {
  const inside = (path: string): string | null => {
    const resolved = join(root, path);
    const rel = relative(root, resolved);
    if (rel.startsWith("..") || rel.split(sep).includes("..")) return null;
    return resolved;
  };

  return {
    async readFile(path) {
      const absolute = inside(path);
      if (!absolute) return null;
      try {
        const info = await stat(absolute);
        if (!info.isFile() || info.size > MAX_SOURCE_BYTES) return null;
        return await readFile(absolute, "utf8");
      } catch {
        return null;
      }
    },

    async listFiles(directory) {
      const absolute = inside(directory);
      if (!absolute) return null;
      const found: string[] = [];
      const walk = async (current: string): Promise<boolean> => {
        let entries: Dirent[];
        try {
          entries = await readdir(current, { withFileTypes: true });
        } catch {
          return false;
        }
        for (const entry of entries) {
          if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
          const child = join(current, entry.name);
          if (entry.isDirectory()) await walk(child);
          else if (entry.isFile()) {
            found.push(relative(root, child).split(sep).join("/"));
          }
        }
        return true;
      };
      return (await walk(absolute)) ? found : null;
    },

    async listDirectory(path) {
      const absolute = inside(path);
      if (!absolute) return null;
      try {
        const entries = await readdir(absolute, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? ("dir" as const) : ("file" as const),
        }));
      } catch {
        return null;
      }
    },
  };
}

export interface ResolveCheckoutGraphOptions {
  /** The checkout root, i.e. the build context. */
  source: string;
  /** The target's directory within it, empty for a repository-root target. */
  rootDirectory: string;
  sha: string;
  log?: BuildLog;
}

/**
 * Resolves what this target imports from the rest of the repository.
 *
 * Runs on the deploy host because it is the only place a checkout exists — the
 * same walk driven from the GitHub API would cost one request per source file
 * in the application. The result goes back to the control plane, which uses it
 * to decide whether the *next* push needs a build at all.
 *
 * Never throws: a graph that could not be resolved simply means the next push
 * falls back to watching every dependency workspace whole, which is what the
 * control plane did before this existed.
 */
export async function resolveCheckoutModuleGraph(
  options: ResolveCheckoutGraphOptions,
): Promise<DeployModuleGraph | null> {
  const rootDirectory = options.rootDirectory.replace(/^\.?\/+|\/+$/g, "");
  // A target that owns the whole repository reads everything in it by
  // definition, so there is nothing for a graph to narrow.
  if (!rootDirectory) return null;

  const started = Date.now();
  try {
    const fs = createCheckoutFs(options.source);
    const workspaces = await collectGraphWorkspaces(fs);
    const holes = new Set<string>();
    const graph = await resolveModuleGraph({
      fs,
      workspaces,
      rootDirectory,
      sha: options.sha,
      onOpaque: (detail) => {
        if (!detail.workspace || detail.workspace === rootDirectory) return;
        holes.add(`${detail.workspace} (${detail.file} → ${detail.specifier})`);
      },
    });

    options.log?.note(
      `resolved ${graph.files.length} imported files outside ${rootDirectory} in ${Date.now() - started}ms` +
        (graph.complete
          ? ""
          : " (incomplete; future pushes will not be skipped)"),
    );
    for (const hole of [...holes].slice(0, 10)) {
      options.log?.note(`watching whole package: ${hole}`);
    }

    return { ...graph, resolvedAt: new Date().toISOString() };
  } catch (error) {
    options.log?.note(
      `import graph resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
