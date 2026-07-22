import "server-only";

import { randomUUID } from "node:crypto";
import type { ImportOverleafTemplateResponse } from "@repo/schemas";
import { unzipSync } from "fflate";

const MAX_TEMPLATE_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
const MAX_FILE_CONTENT_BYTES = 2_800_000;
const MAX_PROJECT_ENTRIES = 64;
const TEMPLATE_PATH = /^\/latex\/templates\/[^/]+\/[^/]+\/?$/;
const TEXT_EXTENSIONS = new Set([
  "asy",
  "bbx",
  "bib",
  "bst",
  "cbx",
  "cfg",
  "clo",
  "cls",
  "csv",
  "def",
  "dtx",
  "inc",
  "ins",
  "ist",
  "latex",
  "lbx",
  "lco",
  "ldf",
  "ltx",
  "lua",
  "md",
  "sty",
  "tex",
  "tikz",
  "txt",
]);
const STANDARD_DOCUMENT_CLASSES = new Set([
  "acmart",
  "article",
  "beamer",
  "book",
  "elsarticle",
  "ieeetran",
  "letter",
  "llncs",
  "memoir",
  "report",
  "scrartcl",
  "scrbook",
  "scrreprt",
  "standalone",
]);
type TemplateFetcher = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

export class OverleafTemplateImportError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "OverleafTemplateImportError";
  }
}

function decodeHtml(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      if (hexadecimal)
        return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      const entities: Record<string, string> = {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: "\u00a0",
        quot: '"',
      };
      return entities[named.toLowerCase()] ?? entity;
    },
  );
}

function safeArchivePath(value: string): string {
  const path = value.replaceAll("\\", "/").replace(/\/$/, "");
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:\//.test(path) ||
    [...path].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) ||
    path.length > 240 ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new OverleafTemplateImportError(
      "The source ZIP contains an unsafe file path",
      422,
    );
  }
  return path;
}

function isIgnoredArchivePath(path: string): boolean {
  const parts = path.split("/");
  const name = parts.at(-1)?.toLowerCase() ?? "";
  return (
    parts.includes("__MACOSX") || parts.includes(".git") || name === ".ds_store"
  );
}

function isTextPath(path: string): boolean {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (name === "makefile" || name === "latexmkrc" || name === ".latexmkrc") {
    return true;
  }
  const extension = name.split(".").at(-1);
  return extension ? TEXT_EXTENSIONS.has(extension) : true;
}

function missingSupportFiles(
  mainSource: string,
  availablePaths: Iterable<string>,
): string[] {
  const basenames = new Set(
    [...availablePaths].map(
      (path) => path.split("/").at(-1)?.toLowerCase() ?? "",
    ),
  );
  const missing = new Set<string>();
  for (const match of mainSource.matchAll(
    /\\documentclass(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g,
  )) {
    for (const rawClass of (match[1] ?? "").split(",")) {
      const className = rawClass.trim();
      if (
        !className ||
        STANDARD_DOCUMENT_CLASSES.has(className.toLowerCase())
      ) {
        continue;
      }
      const filename = `${className}.cls`;
      if (!basenames.has(filename.toLowerCase())) missing.add(filename);
    }
  }
  return [...missing].slice(0, 20);
}

function publicTemplateUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OverleafTemplateImportError(
      "Enter a valid Overleaf template URL",
    );
  }
  const isOverleaf =
    parsed.hostname === "overleaf.com" ||
    parsed.hostname.endsWith(".overleaf.com");
  if (
    parsed.protocol !== "https:" ||
    !isOverleaf ||
    !TEMPLATE_PATH.test(parsed.pathname)
  ) {
    throw new OverleafTemplateImportError(
      "Use a public Overleaf Gallery template URL",
    );
  }
  return new URL(
    `${parsed.pathname}${parsed.search}`,
    "https://www.overleaf.com",
  );
}

function extractTemplate(html: string): ImportOverleafTemplateResponse {
  const sourceModal = html.indexOf('id="modalViewSource"');
  const sourceRegion = sourceModal >= 0 ? html.slice(sourceModal) : html;
  const encodedSource = sourceRegion.match(
    /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i,
  )?.[1];
  if (!encodedSource) {
    throw new OverleafTemplateImportError(
      "Overleaf did not expose source for this template",
      422,
    );
  }
  const source = decodeHtml(encodedSource).replaceAll("\r\n", "\n");
  if (
    !source.trim() ||
    new TextEncoder().encode(source).byteLength > 2_800_000
  ) {
    throw new OverleafTemplateImportError(
      "The exposed template source is empty or too large",
      422,
    );
  }

  const rawName = html.match(
    /<div[^>]*class="[^"]*gallery-item-title[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i,
  )?.[1];
  const name = decodeHtml(
    rawName?.replace(/<[^>]+>/g, "").trim() || "Overleaf template",
  )
    .replaceAll("\u00a0", " ")
    .slice(0, 100);

  const encodedOpenHref = html.match(
    /href="([^"]*\/project\/new\/template\/[^"]+)"/i,
  )?.[1];
  let mainFile = "main.tex";
  if (encodedOpenHref) {
    const candidate = new URL(
      decodeHtml(encodedOpenHref),
      "https://www.overleaf.com",
    ).searchParams.get("mainFile");
    if (
      candidate?.toLowerCase().endsWith(".tex") &&
      !candidate.startsWith("/") &&
      !candidate.includes("\\") &&
      candidate
        .split("/")
        .every((part) => part && part !== "." && part !== "..")
    ) {
      mainFile = candidate;
    }
  }

  return {
    name,
    project: {
      version: 1,
      name,
      mainFile,
      entries: [
        {
          id: randomUUID(),
          path: mainFile,
          kind: "file",
          encoding: "utf8",
          content: source,
        },
      ],
    },
    sourceKind: "page",
    missingSupportFiles: missingSupportFiles(source, [mainFile]),
  };
}

export function importLatexSourceArchive(
  archive: Uint8Array,
  options: { name: string; mainFile?: string },
): ImportOverleafTemplateResponse {
  if (!archive.byteLength || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new OverleafTemplateImportError(
      "The LaTeX source ZIP is empty or larger than 10MB",
      413,
    );
  }

  let declaredBytes = 0;
  let declaredFiles = 0;
  const archiveDirectories: string[] = [];
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(archive, {
      filter(file) {
        if (file.name.endsWith("/")) {
          archiveDirectories.push(file.name);
          return false;
        }
        declaredFiles += 1;
        declaredBytes += file.originalSize;
        if (
          declaredFiles > MAX_PROJECT_ENTRIES ||
          declaredBytes > MAX_PROJECT_BYTES
        ) {
          throw new OverleafTemplateImportError(
            "The LaTeX source project exceeds the 64-file or 4MB limit",
            413,
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof OverleafTemplateImportError) throw error;
    throw new OverleafTemplateImportError(
      "The selected file is not a valid LaTeX source ZIP",
      422,
    );
  }

  const files = Object.entries(unpacked)
    .map(([rawPath, bytes]) => ({ path: safeArchivePath(rawPath), bytes }))
    .filter(({ path }) => !isIgnoredArchivePath(path));
  if (!files.length) {
    throw new OverleafTemplateImportError(
      "The LaTeX source ZIP does not contain project files",
      422,
    );
  }

  const firstParts = new Set(files.map(({ path }) => path.split("/")[0]));
  const stripRoot =
    firstParts.size === 1 && files.every(({ path }) => path.includes("/"));
  const commonRoot = stripRoot ? [...firstParts][0] : undefined;
  const normalizedFiles = files.map(({ path, bytes }) => ({
    path: stripRoot ? path.slice(path.indexOf("/") + 1) : path,
    bytes,
  }));
  const normalizedDirectories = archiveDirectories.flatMap((rawPath) => {
    const path = safeArchivePath(rawPath);
    if (isIgnoredArchivePath(path)) return [];
    if (!commonRoot) return [path];
    if (path === commonRoot) return [];
    return path.startsWith(`${commonRoot}/`)
      ? [path.slice(commonRoot.length + 1)]
      : [path];
  });
  const duplicatePaths = new Set<string>();
  for (const { path } of normalizedFiles) {
    if (duplicatePaths.has(path)) {
      throw new OverleafTemplateImportError(
        "The LaTeX source ZIP contains duplicate file paths",
        422,
      );
    }
    duplicatePaths.add(path);
  }

  const requestedMain = options.mainFile;
  const mainFile =
    (requestedMain
      ? (normalizedFiles.find(({ path }) => path === requestedMain)?.path ??
        normalizedFiles.find(
          ({ path }) =>
            path.split("/").at(-1) === requestedMain.split("/").at(-1),
        )?.path)
      : undefined) ??
    normalizedFiles.find(({ path }) => path.toLowerCase() === "main.tex")
      ?.path ??
    normalizedFiles.find(
      ({ path }) => path.split("/").at(-1)?.toLowerCase() === "main.tex",
    )?.path ??
    normalizedFiles.find(({ path }) => path.toLowerCase().endsWith(".tex"))
      ?.path;
  if (!mainFile) {
    throw new OverleafTemplateImportError(
      "The LaTeX source ZIP does not contain a main .tex file",
      422,
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const folderPaths = new Set(normalizedDirectories);
  const fileEntries = normalizedFiles.map(({ path, bytes }) => {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      folderPaths.add(parts.slice(0, index).join("/"));
    }
    if (bytes.byteLength > MAX_FILE_CONTENT_BYTES) {
      throw new OverleafTemplateImportError(
        `The file ${path} exceeds the project file limit`,
        413,
      );
    }
    if (isTextPath(path)) {
      try {
        return {
          id: randomUUID(),
          path,
          kind: "file" as const,
          encoding: "utf8" as const,
          content: decoder.decode(bytes),
        };
      } catch {
        throw new OverleafTemplateImportError(
          `The text file ${path} is not valid UTF-8`,
          422,
        );
      }
    }
    const content = Buffer.from(bytes).toString("base64");
    if (content.length > MAX_FILE_CONTENT_BYTES) {
      throw new OverleafTemplateImportError(
        `The encoded file ${path} exceeds the project file limit`,
        413,
      );
    }
    return {
      id: randomUUID(),
      path,
      kind: "file" as const,
      encoding: "base64" as const,
      content,
    };
  });
  const entries = [
    ...[...folderPaths].map((path) => ({
      id: randomUUID(),
      path,
      kind: "folder" as const,
    })),
    ...fileEntries,
  ];
  if (entries.length > MAX_PROJECT_ENTRIES) {
    throw new OverleafTemplateImportError(
      "The LaTeX source project exceeds the 64-entry limit",
      413,
    );
  }
  const storedBytes = fileEntries.reduce(
    (total, entry) =>
      total + new TextEncoder().encode(entry.content).byteLength,
    0,
  );
  if (storedBytes > MAX_PROJECT_BYTES) {
    throw new OverleafTemplateImportError(
      "The encoded LaTeX source project exceeds the 4MB limit",
      413,
    );
  }
  const main = fileEntries.find((entry) => entry.path === mainFile);
  if (main?.encoding !== "utf8") {
    throw new OverleafTemplateImportError(
      "The main .tex file must be valid UTF-8",
      422,
    );
  }

  const name = options.name.trim().slice(0, 100) || "Imported LaTeX project";
  return {
    name,
    project: {
      version: 1,
      name,
      mainFile,
      entries,
    },
    sourceKind: "archive",
    missingSupportFiles: missingSupportFiles(
      main.content,
      fileEntries.map((entry) => entry.path),
    ),
  };
}

export function importOverleafTemplateArchive(
  preview: ImportOverleafTemplateResponse,
  archive: Uint8Array,
): ImportOverleafTemplateResponse {
  return importLatexSourceArchive(archive, {
    name: preview.name,
    mainFile: preview.project.mainFile,
  });
}

export async function importOverleafTemplate(
  value: string,
  fetcher: TemplateFetcher = fetch,
): Promise<ImportOverleafTemplateResponse> {
  const url = publicTemplateUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, {
      headers: { "user-agent": "denizlg24-latex-template-import/1.0" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new OverleafTemplateImportError(
        "Overleaf could not load that public template",
        422,
      );
    }
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_TEMPLATE_PAGE_BYTES) {
      throw new OverleafTemplateImportError(
        "The Overleaf template page is too large",
        413,
      );
    }
    const html = await response.text();
    if (new TextEncoder().encode(html).byteLength > MAX_TEMPLATE_PAGE_BYTES) {
      throw new OverleafTemplateImportError(
        "The Overleaf template page is too large",
        413,
      );
    }
    return extractTemplate(html);
  } catch (error) {
    if (error instanceof OverleafTemplateImportError) throw error;
    throw new OverleafTemplateImportError(
      error instanceof DOMException && error.name === "AbortError"
        ? "Overleaf took too long to respond"
        : "Could not import the Overleaf template",
      422,
    );
  } finally {
    clearTimeout(timeout);
  }
}
