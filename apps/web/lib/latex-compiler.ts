import "server-only";

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ILatexProject } from "@repo/schemas";
import { createCompiler } from "node-latex-compiler";

const COMPILE_TIMEOUT_MS = 90_000;
const MAX_LOG_BYTES = 256 * 1024;

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
