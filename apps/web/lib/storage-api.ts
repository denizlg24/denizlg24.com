import "server-only";

const STORAGE_TUS_VERSION = "1.0.0";
const FILE_LOOKUP_PAGE_SIZE = 100;
const folderCache = new Map<string, StorageFolder>();

type StorageBucket = "image" | "file" | "spreadsheet";

interface StorageConfig {
  apiKey: string;
  baseUrl: string;
  imageUploadPath: string;
  fileUploadPath: string;
  spreadsheetPath: string;
}

interface StorageApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

interface StorageApiResponse<T> {
  data: T;
}

interface RootFoldersResponse {
  projectRoot: StorageFolder;
}

interface FolderContentsResponse {
  folder: StorageFolder;
  subfolders: StorageFolder[];
  files: StorageFileSummary[];
}

interface ShareTokenResponse {
  token: string;
}

interface DeleteResponse {
  id: string;
}

interface StorageFolder {
  id: string;
  path: string;
  name: string;
  parentId?: string;
}

interface StorageFileSummary {
  id: string;
  filename: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  tier?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredFile {
  id: string;
  filename: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  publicUrl: string;
  shareToken: string;
}

class StorageApiHttpError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "StorageApiHttpError";
    this.status = status;
    this.code = code;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeStorageName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function getStorageConfig(): StorageConfig {
  return {
    apiKey: requireEnv("STORAGE_API_KEY"),
    baseUrl: requireEnv("STORAGE_API_URL").replace(/\/+$/, ""),
    imageUploadPath: trimSlashes(
      process.env.STORAGE_IMAGE_UPLOAD_PATH ?? "uploads/images",
    ),
    fileUploadPath: trimSlashes(
      process.env.STORAGE_FILE_UPLOAD_PATH ?? "uploads/files",
    ),
    spreadsheetPath: trimSlashes(
      process.env.STORAGE_SPREADSHEET_UPLOAD_PATH ?? "spreadsheets",
    ),
  };
}

function getBucketPath(bucket: StorageBucket): string {
  const config = getStorageConfig();
  switch (bucket) {
    case "image":
      return config.imageUploadPath;
    case "file":
      return config.fileUploadPath;
    case "spreadsheet":
      return config.spreadsheetPath;
  }
}

function getAuthHeaders(extra?: HeadersInit): HeadersInit {
  return {
    "X-API-Key": getStorageConfig().apiKey,
    ...extra,
  };
}

function encodeTusMetadata(
  metadata: Record<string, string | undefined>,
): string {
  return Object.entries(metadata)
    .filter(([, value]) => Boolean(value))
    .map(
      ([key, value]) =>
        `${key} ${Buffer.from(value as string).toString("base64")}`,
    )
    .join(",");
}

function withStorageUrl(path: string): string {
  const { baseUrl } = getStorageConfig();
  return path.startsWith("http") ? path : `${baseUrl}${path}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitFilename(name: string): { base: string; extension: string } {
  const trimmed = name.trim() || "upload";
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) {
    return { base: trimmed, extension: "" };
  }
  return {
    base: trimmed.slice(0, dotIndex),
    extension: trimmed.slice(dotIndex),
  };
}

function makeUniqueFilename(name: string): string {
  const { base, extension } = splitFilename(name);
  return `${base}-${crypto.randomUUID()}${extension}`;
}

async function parseStorageError(
  response: Response,
): Promise<StorageApiHttpError> {
  let code: string | undefined;
  let message = `Storage API request failed with status ${response.status}`;

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as StorageApiErrorBody;
      code = body.error?.code;
      message = body.error?.message ?? message;
    } else {
      const text = await response.text();
      if (text.trim()) {
        message = text.trim();
      }
    }
  } catch {}

  return new StorageApiHttpError(message, response.status, code);
}

async function storageJsonRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(withStorageUrl(path), init);
  if (!response.ok) {
    throw await parseStorageError(response);
  }

  const body = (await response.json()) as StorageApiResponse<T>;
  return body.data;
}

async function storageRawRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(withStorageUrl(path), init);
  if (!response.ok) {
    throw await parseStorageError(response);
  }
  return response;
}

async function getProjectRoot(): Promise<StorageFolder> {
  const cached = folderCache.get("__root__");
  if (cached) return cached;

  const data = await storageJsonRequest<RootFoldersResponse>(
    "/api/folders/roots",
    {
      headers: getAuthHeaders(),
    },
  );

  folderCache.set("__root__", data.projectRoot);
  return data.projectRoot;
}

async function listFolderContents(
  folderId: string,
): Promise<FolderContentsResponse> {
  const params = new URLSearchParams({
    page: "1",
    limit: String(FILE_LOOKUP_PAGE_SIZE),
  });

  return storageJsonRequest<FolderContentsResponse>(
    `/api/folders/${folderId}/contents?${params.toString()}`,
    {
      headers: getAuthHeaders(),
    },
  );
}

async function createFolder(
  parentId: string,
  name: string,
): Promise<StorageFolder> {
  const normalizedName = normalizeStorageName(name);

  try {
    return await storageJsonRequest<StorageFolder>("/api/folders", {
      method: "POST",
      headers: getAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ name, parentId }),
    });
  } catch (error) {
    if (
      error instanceof StorageApiHttpError &&
      error.status === 409 &&
      error.code === "FOLDER_EXISTS"
    ) {
      const contents = await listFolderContents(parentId);
      const existing = contents.subfolders.find(
        (folder) => folder.name === normalizedName,
      );
      if (existing) {
        return existing;
      }
    }

    throw error;
  }
}

async function ensureFolder(relativePath: string): Promise<StorageFolder> {
  const normalizedPath = trimSlashes(relativePath);
  if (!normalizedPath) {
    return getProjectRoot();
  }

  const cached = folderCache.get(normalizedPath);
  if (cached) return cached;

  let currentFolder = await getProjectRoot();
  let currentPath = "";

  for (const rawSegment of normalizedPath.split("/")) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    const normalizedSegment = normalizeStorageName(segment);

    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const currentCached = folderCache.get(currentPath);
    if (currentCached) {
      currentFolder = currentCached;
      continue;
    }

    const contents = await listFolderContents(currentFolder.id);
    let nextFolder = contents.subfolders.find(
      (folder) => folder.name === normalizedSegment,
    );

    if (!nextFolder) {
      nextFolder = await createFolder(currentFolder.id, segment);
    }

    folderCache.set(currentPath, nextFolder);
    currentFolder = nextFolder;
  }

  return currentFolder;
}

async function createUploadSession(
  file: File,
  targetFolder: StorageFolder,
  filename: string,
): Promise<string> {
  const response = await fetch(withStorageUrl("/api/uploads"), {
    method: "POST",
    headers: getAuthHeaders({
      "Tus-Resumable": STORAGE_TUS_VERSION,
      "Upload-Length": String(file.size),
      "Upload-Metadata": encodeTusMetadata({
        filename,
        filetype: file.type || "application/octet-stream",
        targetFolder: targetFolder.path,
      }),
    }),
  });

  if (!response.ok) {
    throw await parseStorageError(response);
  }

  const location = response.headers.get("Location");
  if (!location) {
    throw new Error("Storage API did not return an upload location");
  }

  return withStorageUrl(location);
}

async function finalizeUpload(uploadUrl: string, file: File): Promise<void> {
  const payload = await file.arrayBuffer();
  const response = await fetch(uploadUrl, {
    method: "PATCH",
    headers: getAuthHeaders({
      "Tus-Resumable": STORAGE_TUS_VERSION,
      "Upload-Offset": "0",
      "Content-Type": "application/offset+octet-stream",
    }),
    body: payload,
  });

  if (!response.ok) {
    throw await parseStorageError(response);
  }
}

async function createShareUrl(
  fileId: string,
): Promise<{ token: string; url: string }> {
  const data = await storageJsonRequest<ShareTokenResponse>(
    `/api/files/${fileId}/share`,
    {
      method: "POST",
      headers: getAuthHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ expiresIn: "never" }),
    },
  );

  return {
    token: data.token,
    url: withStorageUrl(`/api/share/${encodeURIComponent(data.token)}`),
  };
}

async function findUploadedFile(
  folderId: string,
  previousFileIds: Set<string>,
  filenameHint: string,
  sizeBytes: number,
): Promise<StorageFileSummary> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const contents = await listFolderContents(folderId);
    const newFile =
      contents.files.find((file) => !previousFileIds.has(file.id)) ??
      contents.files.find((file) => file.filename === filenameHint) ??
      contents.files.find(
        (file) => file.sizeBytes === sizeBytes && !previousFileIds.has(file.id),
      );

    if (newFile) {
      return newFile;
    }

    await delay(150 * (attempt + 1));
  }

  throw new Error(
    "Storage upload completed, but the uploaded file could not be resolved",
  );
}

export async function uploadFileToStorage(
  file: File,
  bucket: StorageBucket,
): Promise<StoredFile> {
  const targetFolder = await ensureFolder(getBucketPath(bucket));
  const existingFiles = await listFolderContents(targetFolder.id);
  const previousFileIds = new Set(
    existingFiles.files.map((existing) => existing.id),
  );

  let storedFilename = file.name || "upload";
  let uploadUrl: string;

  try {
    uploadUrl = await createUploadSession(file, targetFolder, storedFilename);
  } catch (error) {
    if (error instanceof StorageApiHttpError && error.status === 409) {
      storedFilename = makeUniqueFilename(storedFilename);
      uploadUrl = await createUploadSession(file, targetFolder, storedFilename);
    } else {
      throw error;
    }
  }

  await finalizeUpload(uploadUrl, file);

  const uploadedFile = await findUploadedFile(
    targetFolder.id,
    previousFileIds,
    storedFilename,
    file.size,
  );
  const share = await createShareUrl(uploadedFile.id);

  return {
    id: uploadedFile.id,
    filename: uploadedFile.filename,
    path: uploadedFile.path,
    mimeType: uploadedFile.mimeType,
    sizeBytes: uploadedFile.sizeBytes,
    publicUrl: share.url,
    shareToken: share.token,
  };
}

export async function deleteFileFromStorage(fileId: string): Promise<void> {
  await storageJsonRequest<DeleteResponse>(`/api/files/${fileId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
}

export async function downloadJsonFromStorage<T>(fileId: string): Promise<T> {
  const response = await storageRawRequest(`/api/files/${fileId}/download`, {
    headers: getAuthHeaders(),
    cache: "no-store",
  });

  return (await response.json()) as T;
}
