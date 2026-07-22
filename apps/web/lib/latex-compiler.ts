import "server-only";

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve, sep } from "node:path";
import type { ILatexFileEntry, ILatexProject } from "@repo/schemas";
import { Resvg } from "@resvg/resvg-js";
import { createCompiler } from "node-latex-compiler";

const COMPILE_TIMEOUT_MS = 90_000;
const MAX_LOG_BYTES = 256 * 1024;
const compileLocks = new Set<string>();
const INCLUDE_SVG_PATTERN = /\\includesvg(?:\s*\[([^\]]*)\])?\s*\{([^{}]+)\}/g;
const GRAPHICX_OPTIONS = new Set([
  "angle",
  "bb",
  "clip",
  "command",
  "decodearray",
  "draft",
  "ext",
  "height",
  "interpolate",
  "keepaspectratio",
  "origin",
  "page",
  "pagebox",
  "read",
  "scale",
  "totalheight",
  "trim",
  "type",
  "viewport",
  "width",
]);

interface CompilerWithPath {
  tectonicPath: string | null;
}

export interface LatexCompilationResult {
  pdf: Buffer;
  log: string;
}

export class LatexCompilationError extends Error {
  constructor(
    message: string,
    public readonly log: string,
  ) {
    super(message);
    this.name = "LatexCompilationError";
  }
}

/**
 * Process-local admission control keyed by the logical document. Serverless
 * instances can still compile independently, while requests handled by the
 * same instance no longer block unrelated projects.
 */
export function tryAcquireLatexCompileLock(
  projectKey: string,
): (() => void) | null {
  if (compileLocks.has(projectKey)) return null;
  compileLocks.add(projectKey);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    compileLocks.delete(projectKey);
  };
}

function resolveTectonicPath(): string {
  const compiler = createCompiler({
    tectonicPath: process.env.LATEX_TECTONIC_PATH?.trim() || undefined,
  }) as ReturnType<typeof createCompiler> & CompilerWithPath;
  if (!compiler.tectonicPath) {
    throw new Error("Tectonic compiler is unavailable");
  }
  return compiler.tectonicPath;
}

function workspacePath(workspace: string, projectPath: string): string {
  const target = resolve(workspace, ...projectPath.split("/"));
  if (!target.startsWith(`${resolve(workspace)}${sep}`)) {
    throw new Error("Invalid project path");
  }
  return target;
}

function appendBounded(current: string, chunk: Buffer): string {
  if (Buffer.byteLength(current, "utf8") >= MAX_LOG_BYTES) return current;
  const remaining = MAX_LOG_BYTES - Buffer.byteLength(current, "utf8");
  return current + chunk.subarray(0, remaining).toString("utf8");
}

function sanitizeLog(log: string, workspace: string): string {
  return log
    .replaceAll(workspace, ".")
    .replaceAll(workspace.replaceAll("\\", "/"), ".")
    .trim();
}

async function writeProject(workspace: string, project: ILatexProject) {
  for (const entry of project.entries) {
    const target = workspacePath(workspace, entry.path);
    if (entry.kind === "folder") {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    const content =
      entry.encoding === "base64"
        ? Buffer.from(entry.content, "base64")
        : Buffer.from(entry.content, "utf8");
    await writeFile(target, content, { flag: "wx" });
  }
}

function graphicxOptions(value: string | undefined): string {
  if (!value) return "";
  const options: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of value) {
    if (character === "{") depth += 1;
    if (character === "}") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      options.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  options.push(current);
  return options
    .map((option) => option.trim())
    .filter((option) => {
      const key = option.split("=", 1)[0]?.trim().toLowerCase();
      return key ? GRAPHICX_OPTIONS.has(key) : false;
    })
    .join(",");
}

function svgPathForReference(
  reference: string,
  sourcePath: string,
  svgPaths: Set<string>,
): string | null {
  if (reference.includes("\\") || reference.includes("{")) return null;
  const normalized = reference.replace(/^\.\//, "");
  const withExtension = normalized.toLowerCase().endsWith(".svg")
    ? normalized
    : `${normalized}.svg`;
  const candidates = [
    posix.normalize(withExtension),
    posix.normalize(posix.join(posix.dirname(sourcePath), withExtension)),
  ];
  for (const candidate of candidates) {
    if (
      candidate !== ".." &&
      !candidate.startsWith("../") &&
      svgPaths.has(candidate)
    ) {
      return candidate;
    }
  }
  const targetName = posix.basename(withExtension).toLowerCase();
  const basenameMatches = [...svgPaths].filter(
    (path) => posix.basename(path).toLowerCase() === targetName,
  );
  return basenameMatches.length === 1 ? (basenameMatches[0] ?? null) : null;
}

async function prepareSvgAssets(
  workspace: string,
  project: ILatexProject,
): Promise<void> {
  const svgEntries = project.entries.filter(
    (entry): entry is ILatexFileEntry =>
      entry.kind === "file" && entry.path.toLowerCase().endsWith(".svg"),
  );
  if (!svgEntries.length) return;
  const svgByPath = new Map(svgEntries.map((entry) => [entry.path, entry]));
  const svgPaths = new Set(svgByPath.keys());
  const existingPaths = new Set(project.entries.map((entry) => entry.path));
  const generated = new Map<string, { path: string; png: Buffer }>();
  const rewrittenSources: Array<{ path: string; content: string }> = [];

  for (const entry of project.entries) {
    if (
      entry.kind !== "file" ||
      entry.encoding !== "utf8" ||
      !entry.path.match(/\.(?:tex|sty|cls)$/i) ||
      !entry.content.includes("\\includesvg")
    ) {
      continue;
    }
    const content = entry.content.replace(
      INCLUDE_SVG_PATTERN,
      (original, rawOptions: string | undefined, rawReference: string) => {
        const svgPath = svgPathForReference(
          rawReference.trim(),
          entry.path,
          svgPaths,
        );
        if (!svgPath) return original;
        let asset = generated.get(svgPath);
        if (!asset) {
          const svgEntry = svgByPath.get(svgPath);
          if (!svgEntry) return original;
          let generatedPath = `${svgPath}.png`;
          if (existingPaths.has(generatedPath)) {
            generatedPath = `${svgPath}.latex.png`;
          }
          try {
            const svg = Buffer.from(
              svgEntry.content,
              svgEntry.encoding === "base64" ? "base64" : "utf8",
            );
            asset = {
              path: generatedPath,
              png: Buffer.from(
                new Resvg(svg, {
                  fitTo: { mode: "zoom", value: 2 },
                  font: { loadSystemFonts: true },
                })
                  .render()
                  .asPng(),
              ),
            };
            generated.set(svgPath, asset);
            existingPaths.add(generatedPath);
          } catch {
            throw new LatexCompilationError(
              `Could not convert SVG asset ${svgPath}`,
              "",
            );
          }
        }
        const options = graphicxOptions(rawOptions);
        return `\\includegraphics${options ? `[${options}]` : ""}{${asset.path}}`;
      },
    );
    if (content !== entry.content) {
      rewrittenSources.push({ path: entry.path, content });
    }
  }

  await Promise.all([
    ...[...generated.values()].map(async (asset) => {
      const target = workspacePath(workspace, asset.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, asset.png, { flag: "wx" });
    }),
    ...rewrittenSources.map(({ path, content }) =>
      writeFile(workspacePath(workspace, path), content, "utf8"),
    ),
  ]);
}

async function runTectonic(
  tectonicPath: string,
  workspace: string,
  mainFile: string,
): Promise<string> {
  const input = workspacePath(workspace, mainFile);
  const cachePath = join(tmpdir(), "deniz-tectonic-cache");
  await mkdir(cachePath, { recursive: true });

  return new Promise((resolvePromise, rejectPromise) => {
    let output = "";
    let timedOut = false;
    const child = spawn(
      tectonicPath,
      [
        "--untrusted",
        "--keep-logs",
        "--color",
        "never",
        "--outdir",
        workspace,
        input,
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          TECTONIC_UNTRUSTED_MODE: "1",
          XDG_CACHE_HOME: cachePath,
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    child.stdout.on("data", (chunk: Buffer) => {
      output = appendBounded(output, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output = appendBounded(output, chunk);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, COMPILE_TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      const log = sanitizeLog(output, workspace);
      if (timedOut) {
        rejectPromise(new LatexCompilationError("Compilation timed out", log));
        return;
      }
      if (code !== 0) {
        rejectPromise(
          new LatexCompilationError("LaTeX compilation failed", log),
        );
        return;
      }
      resolvePromise(log);
    });
  });
}

export async function compileLatexProject(
  project: ILatexProject,
): Promise<LatexCompilationResult> {
  const workspace = await mkdtemp(join(tmpdir(), "deniz-latex-"));
  try {
    await writeProject(workspace, project);
    await prepareSvgAssets(workspace, project);
    const log = await runTectonic(
      resolveTectonicPath(),
      workspace,
      project.mainFile,
    );
    const outputName = `${basename(project.mainFile, ".tex")}.pdf`;
    const pdf = await readFile(join(workspace, outputName));
    if (
      pdf.byteLength === 0 ||
      !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))
    ) {
      throw new LatexCompilationError("Compiler produced an invalid PDF", log);
    }
    return { pdf, log };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
