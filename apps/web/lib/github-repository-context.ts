const GITHUB_API_BASE_URL = "https://api.github.com";

export const DEFAULT_MAX_REPOSITORY_FILES = 8;
export const HARD_MAX_REPOSITORY_FILES = 12;
export const PER_FILE_CONTENT_CAP = 6000;
export const TOTAL_CONTENT_CAP = 30000;

const MAX_FETCHABLE_TEXT_FILE_BYTES = 120_000;
const MAX_LOCKFILE_BYTES = 12_000;

const MANIFEST_FILE_REASONS = new Map<string, string>([
  ["package.json", "Project manifest showing dependencies and scripts."],
  ["pyproject.toml", "Python project manifest with package and build details."],
  ["requirements.txt", "Dependency list for the Python environment."],
  ["cargo.toml", "Rust package manifest and dependency graph."],
  ["go.mod", "Go module manifest describing the project module graph."],
  ["pom.xml", "Maven build manifest and dependency configuration."],
  ["build.gradle", "Gradle build definition for the project."],
  ["build.gradle.kts", "Gradle Kotlin build definition for the project."],
  ["composer.json", "PHP project manifest and dependency configuration."],
  ["gemfile", "Ruby dependency manifest."],
  ["mix.exs", "Elixir project manifest and dependency configuration."],
  ["deno.json", "Deno project configuration."],
  ["deno.jsonc", "Deno project configuration."],
  ["bunfig.toml", "Bun runtime configuration for the project."],
]);

const CONFIG_FILE_REASONS = new Map<string, string>([
  ["tsconfig.json", "TypeScript configuration reveals compiler setup."],
  ["next.config.js", "Next.js configuration reveals runtime and build setup."],
  ["next.config.mjs", "Next.js configuration reveals runtime and build setup."],
  ["next.config.ts", "Next.js configuration reveals runtime and build setup."],
  ["vite.config.js", "Bundler configuration reveals the frontend setup."],
  ["vite.config.ts", "Bundler configuration reveals the frontend setup."],
  [
    "tailwind.config.js",
    "Tailwind configuration helps explain styling structure.",
  ],
  [
    "tailwind.config.ts",
    "Tailwind configuration helps explain styling structure.",
  ],
  ["biome.json", "Biome configuration shows linting and formatting rules."],
  ["eslint.config.js", "Lint configuration helps explain code quality rules."],
  ["eslint.config.mjs", "Lint configuration helps explain code quality rules."],
  ["eslint.config.ts", "Lint configuration helps explain code quality rules."],
]);

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "poetry.lock",
]);

const SECRET_LIKE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.test",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
  "authorized_keys",
  "known_hosts",
]);

const SECRET_LIKE_EXTENSIONS = new Set([
  ".cer",
  ".crt",
  ".csr",
  ".key",
  ".pem",
  ".p12",
  ".pfx",
  ".pub",
]);

const BINARY_OR_MEDIA_EXTENSIONS = new Set([
  ".7z",
  ".ai",
  ".avif",
  ".bmp",
  ".class",
  ".cur",
  ".dll",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".rar",
  ".so",
  ".svgz",
  ".tar",
  ".tif",
  ".tiff",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

const GENERATED_DIRECTORY_PREFIXES = [
  ".git/",
  ".next/",
  ".output/",
  ".turbo/",
  ".vercel/",
  "build/",
  "coverage/",
  "dist/",
  "node_modules/",
  "target/",
  "vendor/",
];

export interface GitHubRepositoryIdentity {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
}

export interface GitHubRepositoryContextFile {
  path: string;
  reason: string;
  truncated: boolean;
  content: string;
}

export interface GitHubRepositoryContext {
  repository: GitHubRepositoryIdentity;
  selectedBranch: string;
  defaultBranch: string;
  description: string | null;
  homepage: string | null;
  topics: string[];
  languages: string[];
  selectedFiles: GitHubRepositoryContextFile[];
  suggestedFollowUpPaths: string[];
  warnings: string[];
}

export interface GitHubRepositoryContextOptions {
  repository: string;
  branch?: string;
  includePaths?: string[];
  maxFiles?: number;
}

export interface GitHubTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

type SelectedTreeFile = GitHubTreeEntry & {
  reason: string;
  score: number;
};

interface GitHubRepositoryApiResponse {
  name: string;
  full_name: string;
  description: string | null;
  homepage: string | null;
  html_url: string;
  default_branch: string;
  topics?: string[];
  owner: {
    login: string;
  };
}

interface GitHubTreeApiResponse {
  truncated: boolean;
  tree: GitHubTreeEntry[];
}

interface GitHubBlobApiResponse {
  content: string;
  encoding: string;
}

function getPathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function getBaseName(path: string): string {
  const segments = getPathSegments(path);
  return segments.at(-1) ?? path;
}

function normalizeRepositoryPath(path: string): string {
  return path.trim().replace(/^\/+/, "").replace(/\\/g, "/");
}

function normalizeOptionalHttpUrl(url: string | null): string | null {
  if (!url) return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("URL must use http or https.");
  }

  parsed.hash = "";

  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

function compareCandidateFiles(
  a: SelectedTreeFile,
  b: SelectedTreeFile,
): number {
  if (a.score !== b.score) return b.score - a.score;

  const depthDifference =
    getPathSegments(a.path).length - getPathSegments(b.path).length;
  if (depthDifference !== 0) return depthDifference;

  const sizeDifference = (a.size ?? 0) - (b.size ?? 0);
  if (sizeDifference !== 0) return sizeDifference;

  return a.path.localeCompare(b.path);
}

function getFileExtension(path: string): string {
  const baseName = getBaseName(path);
  const dotIndex = baseName.lastIndexOf(".");
  return dotIndex >= 0 ? baseName.slice(dotIndex).toLowerCase() : "";
}

function isGeneratedPath(path: string): boolean {
  const normalizedPath = normalizeRepositoryPath(path).toLowerCase();
  return GENERATED_DIRECTORY_PREFIXES.some((prefix) =>
    normalizedPath.startsWith(prefix),
  );
}

function isSecretLikePath(path: string): boolean {
  const normalizedPath = normalizeRepositoryPath(path);
  const lowerPath = normalizedPath.toLowerCase();
  const baseName = getBaseName(lowerPath);
  const extension = getFileExtension(lowerPath);

  if (
    baseName === ".env" ||
    baseName.startsWith(".env.") ||
    SECRET_LIKE_FILE_NAMES.has(baseName) ||
    SECRET_LIKE_EXTENSIONS.has(extension)
  ) {
    return true;
  }

  return /(^|\/)(secrets?|credentials?|private|tokens?)(\/|\.|$)/i.test(
    normalizedPath,
  );
}

function isBinaryOrMediaPath(path: string): boolean {
  return BINARY_OR_MEDIA_EXTENSIONS.has(getFileExtension(path));
}

function isLockfilePath(path: string): boolean {
  return LOCKFILE_NAMES.has(getBaseName(path).toLowerCase());
}

function isProbablyBinaryBuffer(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let suspiciousBytes = 0;

  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) suspiciousBytes += 1;
  }

  return sample.length > 0 && suspiciousBytes / sample.length > 0.1;
}

function getRankedReason(
  path: string,
): { score: number; reason: string } | null {
  const normalizedPath = normalizeRepositoryPath(path);
  const lowerPath = normalizedPath.toLowerCase();
  const baseName = getBaseName(lowerPath);

  if (/^readme(\.[^.]+)?$/i.test(getBaseName(normalizedPath))) {
    return {
      score: 120,
      reason:
        "Repository README usually explains the product, setup, and scope.",
    };
  }

  const manifestReason = MANIFEST_FILE_REASONS.get(baseName);
  if (manifestReason) {
    return { score: 110, reason: manifestReason };
  }

  const configReason = CONFIG_FILE_REASONS.get(baseName);
  if (configReason) {
    return { score: 90, reason: configReason };
  }

  if (
    [
      "app/page.tsx",
      "app/page.jsx",
      "src/app/page.tsx",
      "src/app/page.jsx",
      "pages/index.tsx",
      "pages/index.jsx",
      "src/pages/index.tsx",
      "src/pages/index.jsx",
      "src/app.tsx",
      "src/app.jsx",
      "src/main.ts",
      "src/main.tsx",
      "src/index.ts",
      "src/index.tsx",
      "main.py",
      "app.py",
      "main.go",
      "main.rs",
    ].includes(lowerPath)
  ) {
    return {
      score: 80,
      reason: "Primary entrypoint that shows how the application is assembled.",
    };
  }

  if (
    lowerPath.startsWith("docs/") &&
    [".md", ".mdx", ".txt"].includes(getFileExtension(lowerPath))
  ) {
    return {
      score: 55,
      reason:
        "Project documentation can provide architecture or usage context.",
    };
  }

  if (
    [".md", ".mdx", ".txt"].includes(getFileExtension(lowerPath)) &&
    getPathSegments(lowerPath).length <= 2
  ) {
    return {
      score: 40,
      reason: "Top-level documentation often adds helpful project context.",
    };
  }

  return null;
}

function getGitHubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "denizlg24-portfolio-2026",
  };

  if (process.env.GITHUB_TOKEN?.trim()) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  }

  return headers;
}

async function fetchGitHubJson<T>(path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    headers: getGitHubHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `GitHub API request failed with status ${response.status}.`;

    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Ignore JSON parsing errors and keep the default message.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function parseGitHubRepositoryInput(
  repository: string,
): GitHubRepositoryIdentity {
  const trimmed = repository.trim();
  if (!trimmed) {
    throw new Error("Repository is required.");
  }

  let owner = "";
  let repo = "";

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "github.com" && hostname !== "www.github.com") {
      throw new Error("Only GitHub repositories are supported.");
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error(
        "GitHub repository URLs must include both owner and repository.",
      );
    }

    [owner, repo] = segments;
  } else {
    const segments = trimmed.split("/").filter(Boolean);
    if (segments.length !== 2) {
      throw new Error(
        "Repository must be a full GitHub URL or in owner/repo format.",
      );
    }

    [owner, repo] = segments;
  }

  owner = owner.trim();
  repo = repo.trim().replace(/\.git$/i, "");

  if (!owner || !repo) {
    throw new Error(
      "Repository must be a full GitHub URL or in owner/repo format.",
    );
  }

  const fullName = `${owner}/${repo}`;

  return {
    owner,
    repo,
    fullName,
    url: `https://github.com/${fullName}`,
  };
}

export function canonicalizeGitHubRepositoryUrl(repository: string): string {
  return parseGitHubRepositoryInput(repository).url;
}

export function selectGitHubRepositoryFiles({
  tree,
  includePaths = [],
  maxFiles = DEFAULT_MAX_REPOSITORY_FILES,
}: {
  tree: GitHubTreeEntry[];
  includePaths?: string[];
  maxFiles?: number;
}): {
  selected: SelectedTreeFile[];
  suggestedFollowUpPaths: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const normalizedMaxFiles = Math.max(
    1,
    Math.min(maxFiles, HARD_MAX_REPOSITORY_FILES),
  );

  if (maxFiles > HARD_MAX_REPOSITORY_FILES) {
    warnings.push(
      `maxFiles was capped at ${HARD_MAX_REPOSITORY_FILES} to stay within tool limits.`,
    );
  }

  const files = tree.filter(
    (entry): entry is GitHubTreeEntry =>
      entry.type === "blob" &&
      !isGeneratedPath(entry.path) &&
      !isSecretLikePath(entry.path) &&
      !isBinaryOrMediaPath(entry.path) &&
      (!isLockfilePath(entry.path) || (entry.size ?? 0) <= MAX_LOCKFILE_BYTES),
  );

  const fileMap = new Map(
    files.map((entry) => [normalizeRepositoryPath(entry.path), entry]),
  );
  const selected = new Map<string, SelectedTreeFile>();

  for (const requestedPath of includePaths) {
    const normalizedPath = normalizeRepositoryPath(requestedPath);
    if (!normalizedPath) continue;

    const entry = fileMap.get(normalizedPath);
    if (!entry) {
      const allTreeEntry = tree.find(
        (treeEntry) =>
          normalizeRepositoryPath(treeEntry.path) === normalizedPath,
      );

      if (!allTreeEntry) {
        warnings.push(`Requested path "${normalizedPath}" was not found.`);
        continue;
      }

      if (isSecretLikePath(normalizedPath)) {
        warnings.push(
          `Requested path "${normalizedPath}" was skipped because it may contain secrets.`,
        );
        continue;
      }

      if (isBinaryOrMediaPath(normalizedPath)) {
        warnings.push(
          `Requested path "${normalizedPath}" was skipped because it is not a text file.`,
        );
        continue;
      }

      if (isLockfilePath(normalizedPath)) {
        warnings.push(
          `Requested path "${normalizedPath}" was skipped because large lockfiles are excluded.`,
        );
        continue;
      }

      warnings.push(
        `Requested path "${normalizedPath}" was skipped by repository file filters.`,
      );
      continue;
    }

    selected.set(normalizedPath, {
      ...entry,
      score: Number.MAX_SAFE_INTEGER,
      reason: "Explicitly requested via includePaths.",
    });
  }

  const rankedFiles = files
    .map((entry) => {
      const rankedReason = getRankedReason(entry.path);
      if (!rankedReason) return null;

      return {
        ...entry,
        ...rankedReason,
      } satisfies SelectedTreeFile;
    })
    .filter((entry): entry is SelectedTreeFile => entry !== null)
    .sort(compareCandidateFiles);

  for (const entry of rankedFiles) {
    if (selected.size >= normalizedMaxFiles) break;

    const normalizedPath = normalizeRepositoryPath(entry.path);
    if (selected.has(normalizedPath)) continue;

    selected.set(normalizedPath, entry);
  }

  const suggestedFollowUpPaths = rankedFiles
    .filter((entry) => !selected.has(normalizeRepositoryPath(entry.path)))
    .slice(0, HARD_MAX_REPOSITORY_FILES)
    .map((entry) => entry.path);

  return {
    selected: [...selected.values()].slice(0, normalizedMaxFiles),
    suggestedFollowUpPaths,
    warnings,
  };
}

async function fetchBlobTextContent({
  owner,
  repo,
  sha,
}: {
  owner: string;
  repo: string;
  sha: string;
}): Promise<Buffer> {
  const blob = await fetchGitHubJson<GitHubBlobApiResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(sha)}`,
  );

  if (blob.encoding !== "base64") {
    throw new Error("Unsupported GitHub blob encoding.");
  }

  return Buffer.from(blob.content.replace(/\n/g, ""), "base64");
}

export async function getGitHubRepositoryContext(
  options: GitHubRepositoryContextOptions,
): Promise<GitHubRepositoryContext> {
  const parsedRepository = parseGitHubRepositoryInput(options.repository);
  const warnings: string[] = [];

  if (!process.env.GITHUB_TOKEN?.trim()) {
    warnings.push(
      "GITHUB_TOKEN is not configured; using GitHub unauthenticated API requests.",
    );
  }

  const repository = await fetchGitHubJson<GitHubRepositoryApiResponse>(
    `/repos/${encodeURIComponent(parsedRepository.owner)}/${encodeURIComponent(parsedRepository.repo)}`,
  );

  const canonicalRepository: GitHubRepositoryIdentity = {
    owner: repository.owner.login,
    repo: repository.name,
    fullName: repository.full_name,
    url: repository.html_url.replace(/\/+$/, ""),
  };

  const defaultBranch = repository.default_branch;
  const selectedBranch = options.branch?.trim() || defaultBranch;

  const [languagesResponse, treeResponse] = await Promise.all([
    fetchGitHubJson<Record<string, number>>(
      `/repos/${encodeURIComponent(canonicalRepository.owner)}/${encodeURIComponent(canonicalRepository.repo)}/languages`,
    ),
    fetchGitHubJson<GitHubTreeApiResponse>(
      `/repos/${encodeURIComponent(canonicalRepository.owner)}/${encodeURIComponent(canonicalRepository.repo)}/git/trees/${encodeURIComponent(selectedBranch)}?recursive=1`,
    ),
  ]);

  if (treeResponse.truncated) {
    warnings.push(
      "GitHub returned a truncated repository tree, so file suggestions may be incomplete.",
    );
  }

  const selection = selectGitHubRepositoryFiles({
    tree: treeResponse.tree,
    includePaths: options.includePaths,
    maxFiles: options.maxFiles,
  });

  warnings.push(...selection.warnings);

  const selectedFiles: GitHubRepositoryContextFile[] = [];
  let remainingContentBudget = TOTAL_CONTENT_CAP;

  for (const file of selection.selected) {
    if (remainingContentBudget <= 0) {
      warnings.push(
        `Stopped reading additional files after reaching the ${TOTAL_CONTENT_CAP}-character response cap.`,
      );
      break;
    }

    if ((file.size ?? 0) > MAX_FETCHABLE_TEXT_FILE_BYTES) {
      warnings.push(
        `Skipped "${file.path}" because it is too large to inspect safely.`,
      );
      continue;
    }

    try {
      const buffer = await fetchBlobTextContent({
        owner: canonicalRepository.owner,
        repo: canonicalRepository.repo,
        sha: file.sha,
      });

      if (isProbablyBinaryBuffer(buffer)) {
        warnings.push(
          `Skipped "${file.path}" because it appears to be binary content.`,
        );
        continue;
      }

      const content = buffer.toString("utf-8");
      const fileBudget = Math.min(PER_FILE_CONTENT_CAP, remainingContentBudget);
      const truncated = content.length > fileBudget;

      selectedFiles.push({
        path: file.path,
        reason: file.reason,
        truncated,
        content: content.slice(0, fileBudget),
      });

      remainingContentBudget -= Math.min(content.length, fileBudget);
    } catch (error) {
      warnings.push(
        `Failed to read "${file.path}": ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  const languages = Object.entries(languagesResponse)
    .sort(([, leftBytes], [, rightBytes]) => rightBytes - leftBytes)
    .map(([language]) => language);

  return {
    repository: canonicalRepository,
    selectedBranch,
    defaultBranch,
    description: repository.description,
    homepage: normalizeOptionalHttpUrl(repository.homepage),
    topics: repository.topics ?? [],
    languages,
    selectedFiles,
    suggestedFollowUpPaths: selection.suggestedFollowUpPaths,
    warnings,
  };
}
