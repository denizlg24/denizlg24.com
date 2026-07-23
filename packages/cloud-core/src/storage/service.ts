import { open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  downloadArchiveInputSchema,
  shareExpiresInSchema,
  updateFileInputSchema,
} from "@repo/schemas/cloud";
import { and, count, desc, eq, inArray, like, ne, or, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  type Folder,
  files,
  folders,
  type StorageFile,
  tusUploads,
} from "../db/schema";
import {
  buildFileDocument,
  buildFolderDocument,
  indexStorageDocuments,
  type MeiliSearch,
  removeStorageDocuments,
  STORAGE_INDEX_UID,
  searchStorageIndex,
} from "../search";
import type { StoragePrincipal } from "./access";
import { checkStorageAccess } from "./access";
import { type ArchiveEntry, createZipStream } from "./archive";
import type { StorageConfig } from "./config";
import { contentDisposition } from "./content-disposition";
import {
  computeChecksum,
  copyAndVerify,
  deletePath,
  ensureDir,
  fsyncFile,
  getDiskStats,
  pathExists,
} from "./fs";
import {
  buildProjectRootPath,
  buildUserRootPath,
  isSharedPath,
  joinPath,
  normalizeFileName,
  normalizeName,
  PathValidationError,
  parentPath,
  resolveHddDiskPath,
  resolveSsdDiskPath,
  SHARED_ROOT_PATH,
  validatePath,
} from "./path";
import { generateShareToken, verifyShareToken } from "./share";
import type { PromotionQueue } from "./tiering";

const TUS_VERSION = "1.0.0";
const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1_000;

function fileRangeStream(
  diskPath: string,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let position = start;

  const close = async (): Promise<void> => {
    const current = handle;
    handle = null;
    await current?.close();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      handle ??= await open(diskPath, "r");
      const length = Math.min(64 * 1024, end - position + 1);
      if (length <= 0) {
        controller.close();
        await close();
        return;
      }

      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead === 0) {
        controller.close();
        await close();
        return;
      }

      position += bytesRead;
      controller.enqueue(buffer.subarray(0, bytesRead));
      if (position > end) {
        controller.close();
        await close();
      }
    },
    async cancel() {
      await close();
    },
  });
}

export class StorageServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 410 | 413 | 415 | 500,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StorageServiceError";
  }
}

function deny(
  principal: StoragePrincipal,
  path: string,
  scope: "storage:read" | "storage:write" | "storage:delete",
  ownerId: string | null,
  mode: "read" | "modify",
): void {
  const result = checkStorageAccess(principal, path, scope, ownerId, mode);
  if (!result.allowed) {
    throw new StorageServiceError(403, result.code, result.message);
  }
}

function pagination(query: URLSearchParams, maxLimit: number) {
  const page = Math.max(1, Number.parseInt(query.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.parseInt(query.get("limit") ?? "50", 10) || 50),
  );
  return { page, limit, offset: (page - 1) * limit };
}

function descendantPattern(path: string): string {
  return `${path.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}/%`;
}

function parseTusMetadata(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of header.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(" ");
    const key = separator < 0 ? trimmed : trimmed.slice(0, separator);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new StorageServiceError(
        400,
        "INVALID_METADATA",
        "Upload-Metadata contains an invalid key",
      );
    }
    if (separator < 0) {
      result[key] = "";
      continue;
    }
    try {
      result[key] = Buffer.from(
        trimmed.slice(separator + 1),
        "base64",
      ).toString("utf8");
    } catch {
      throw new StorageServiceError(
        400,
        "INVALID_METADATA",
        "Upload-Metadata contains invalid base64",
      );
    }
  }
  return result;
}

async function storageRoot(
  db: Database,
  config: StorageConfig,
  ownerId: string | null,
  path: string,
  name: string,
): Promise<Folder> {
  const existing = await db.query.folders.findFirst({
    where: eq(folders.path, path),
  });
  if (existing) return existing;
  await ensureDir(resolveSsdDiskPath(config.ssdStoragePath, path));
  const [created] = await db
    .insert(folders)
    .values({ ownerId, path, name })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const concurrent = await db.query.folders.findFirst({
    where: eq(folders.path, path),
  });
  if (!concurrent) throw new Error(`Failed to initialize storage root ${path}`);
  return concurrent;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonBody(value: unknown): Record<string, unknown> {
  if (!isJsonRecord(value)) {
    throw new StorageServiceError(400, "INVALID_INPUT", "Invalid request body");
  }
  return value;
}

export class StorageService {
  readonly #uploadLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly meili: MeiliSearch,
    private readonly config: StorageConfig,
    private readonly promotions: PromotionQueue,
  ) {}

  async initialize(): Promise<void> {
    await Promise.all([
      ensureDir(this.config.ssdStoragePath),
      ensureDir(this.config.hddStoragePath),
      ensureDir(this.config.tempUploadPath),
    ]);
  }

  async roots(principal: StoragePrincipal) {
    if (principal.project) {
      deny(
        principal,
        buildProjectRootPath(principal.project.slug),
        "storage:read",
        principal.project.ownerId,
        "read",
      );
      const folder = principal.project.storageFolderId
        ? await this.db.query.folders.findFirst({
            where: eq(folders.id, principal.project.storageFolderId),
          })
        : undefined;
      if (!folder) {
        throw new StorageServiceError(
          500,
          "PROJECT_FOLDER_MISSING",
          "Project storage folder not found",
        );
      }
      return {
        projectRoot: { id: folder.id, path: folder.path, name: folder.name },
      };
    }
    const [userRoot, sharedRoot] = await Promise.all([
      storageRoot(
        this.db,
        this.config,
        principal.user.id,
        buildUserRootPath(principal.user.id),
        principal.user.id,
      ),
      storageRoot(this.db, this.config, null, SHARED_ROOT_PATH, "shared"),
    ]);
    return {
      userRoot: { id: userRoot.id, path: userRoot.path, name: userRoot.name },
      sharedRoot: {
        id: sharedRoot.id,
        path: sharedRoot.path,
        name: sharedRoot.name,
      },
    };
  }

  async createFolder(principal: StoragePrincipal, bodyValue: unknown) {
    const body = safeJsonBody(bodyValue);
    if (typeof body.name !== "string" || body.name.length === 0) {
      throw new StorageServiceError(
        400,
        "MISSING_NAME",
        "Folder name is required",
      );
    }
    if (typeof body.parentId !== "string") {
      throw new StorageServiceError(
        400,
        "MISSING_PARENT_ID",
        "parentId is required",
      );
    }
    const parent = await this.db.query.folders.findFirst({
      where: eq(folders.id, body.parentId),
    });
    if (!parent) {
      throw new StorageServiceError(
        404,
        "PARENT_NOT_FOUND",
        "Parent folder not found",
      );
    }
    deny(
      principal,
      parent.path,
      "storage:write",
      parent.ownerId,
      isSharedPath(parent.path) ? "read" : "modify",
    );
    let name: string;
    try {
      name = normalizeName(body.name);
    } catch (error) {
      if (error instanceof PathValidationError) {
        throw new StorageServiceError(400, "INVALID_NAME", error.message);
      }
      throw error;
    }
    const path = joinPath(parent.path, name);
    if (
      await this.db.query.folders.findFirst({
        where: eq(folders.path, path),
      })
    ) {
      throw new StorageServiceError(
        409,
        "FOLDER_EXISTS",
        "A folder already exists at this path",
      );
    }
    const diskPath = resolveSsdDiskPath(this.config.ssdStoragePath, path);
    await ensureDir(diskPath);
    try {
      const [created] = await this.db
        .insert(folders)
        .values({
          ownerId: principal.user.id,
          parentId: parent.id,
          path,
          name,
        })
        .returning();
      if (!created) throw new Error("Failed to create folder");
      const document = buildFolderDocument(created);
      if (document) {
        void indexStorageDocuments(this.meili, [document]).catch(console.error);
      }
      return created;
    } catch (error) {
      await deletePath(diskPath, true);
      throw error;
    }
  }

  async getFolder(principal: StoragePrincipal, id: string): Promise<Folder> {
    const folder = await this.findFolder(id);
    deny(principal, folder.path, "storage:read", folder.ownerId, "read");
    return folder;
  }

  async folderContents(
    principal: StoragePrincipal,
    id: string,
    query: URLSearchParams,
  ) {
    const folder = await this.findFolder(id);
    deny(principal, folder.path, "storage:read", folder.ownerId, "read");
    const { page, limit, offset } = pagination(query, 100);
    const [subfolders, fileList, countResult] = await Promise.all([
      this.db
        .select({
          id: folders.id,
          name: folders.name,
          path: folders.path,
          parentId: folders.parentId,
          createdAt: folders.createdAt,
        })
        .from(folders)
        .where(eq(folders.parentId, id))
        .orderBy(folders.name),
      this.db
        .select({
          id: files.id,
          filename: files.filename,
          path: files.path,
          mimeType: files.mimeType,
          sizeBytes: files.sizeBytes,
          tier: files.tier,
          createdAt: files.createdAt,
          updatedAt: files.updatedAt,
        })
        .from(files)
        .where(eq(files.folderId, id))
        .orderBy(desc(files.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(files)
        .where(eq(files.folderId, id)),
    ]);
    const total = countResult[0]?.count ?? 0;
    return {
      data: {
        folder: {
          id: folder.id,
          path: folder.path,
          name: folder.name,
          parentId: folder.parentId,
        },
        subfolders,
        files: fileList,
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async updateFolder(
    principal: StoragePrincipal,
    id: string,
    bodyValue: unknown,
  ) {
    const body = safeJsonBody(bodyValue);
    const requestedName = typeof body.name === "string" ? body.name : undefined;
    const requestedParentId =
      typeof body.parentId === "string" ? body.parentId : undefined;
    if (!requestedName && !requestedParentId) {
      throw new StorageServiceError(
        400,
        "NOTHING_TO_UPDATE",
        "Provide name or parentId",
      );
    }
    const folder = await this.getFolder(principal, id);
    if (
      folder.path === buildUserRootPath(principal.user.id) ||
      folder.path === SHARED_ROOT_PATH ||
      (principal.project &&
        folder.path === buildProjectRootPath(principal.project.slug))
    ) {
      throw new StorageServiceError(
        403,
        "CANNOT_MODIFY_ROOT",
        "Cannot rename or move root folders",
      );
    }
    deny(principal, folder.path, "storage:write", folder.ownerId, "modify");
    let name: string;
    try {
      name = requestedName ? normalizeName(requestedName) : folder.name;
    } catch (error) {
      if (error instanceof PathValidationError) {
        throw new StorageServiceError(400, "INVALID_NAME", error.message);
      }
      throw error;
    }
    let targetParentId = folder.parentId;
    let targetParentPath = parentPath(folder.path);
    if (requestedParentId) {
      const target = await this.findFolder(requestedParentId);
      deny(
        principal,
        target.path,
        "storage:write",
        target.ownerId,
        isSharedPath(target.path) ? "read" : "modify",
      );
      if (
        target.path === folder.path ||
        target.path.startsWith(`${folder.path}/`)
      ) {
        throw new StorageServiceError(
          400,
          "CIRCULAR_MOVE",
          "Cannot move a folder into itself or its descendant",
        );
      }
      targetParentId = target.id;
      targetParentPath = target.path;
    }
    const newPath = joinPath(targetParentPath, name);
    if (newPath === folder.path) {
      return folder;
    }
    if (
      await this.db.query.folders.findFirst({
        where: eq(folders.path, newPath),
      })
    ) {
      throw new StorageServiceError(
        409,
        "FOLDER_EXISTS",
        "A folder already exists at the target path",
      );
    }
    const oldDiskPath = resolveSsdDiskPath(
      this.config.ssdStoragePath,
      folder.path,
    );
    const newDiskPath = resolveSsdDiskPath(this.config.ssdStoragePath, newPath);
    await ensureDir(dirname(newDiskPath));
    await rename(oldDiskPath, newDiskPath);
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(folders)
          .set({
            path: newPath,
            name,
            parentId: targetParentId,
            updatedAt: new Date(),
          })
          .where(eq(folders.id, id));
        await tx
          .update(folders)
          .set({
            path: sql`REPLACE(${folders.path}, ${folder.path}, ${newPath})`,
            updatedAt: new Date(),
          })
          .where(like(folders.path, descendantPattern(folder.path)));
        await tx
          .update(files)
          .set({
            path: sql`REPLACE(${files.path}, ${folder.path}, ${newPath})`,
            diskPath: sql`CASE WHEN ${files.tier} = 'ssd' THEN REPLACE(${files.diskPath}, ${oldDiskPath}, ${newDiskPath}) ELSE ${files.diskPath} END`,
            updatedAt: new Date(),
          })
          .where(like(files.path, descendantPattern(folder.path)));
      });
    } catch (error) {
      await rename(newDiskPath, oldDiskPath).catch(console.error);
      throw error;
    }
    void this.reindexPath(newPath);
    return { ...folder, path: newPath, name, parentId: targetParentId };
  }

  async deleteFolder(principal: StoragePrincipal, id: string): Promise<void> {
    const folder = await this.findFolder(id);
    if (
      folder.path === buildUserRootPath(principal.user.id) ||
      folder.path === SHARED_ROOT_PATH ||
      (principal.project &&
        folder.path === buildProjectRootPath(principal.project.slug))
    ) {
      throw new StorageServiceError(
        403,
        "CANNOT_DELETE_ROOT",
        "Cannot delete root folders",
      );
    }
    deny(principal, folder.path, "storage:delete", folder.ownerId, "modify");
    const [childFolders, childFiles] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(folders)
        .where(eq(folders.parentId, id)),
      this.db
        .select({ count: count() })
        .from(files)
        .where(eq(files.folderId, id)),
    ]);
    if ((childFolders[0]?.count ?? 0) > 0 || (childFiles[0]?.count ?? 0) > 0) {
      throw new StorageServiceError(
        409,
        "FOLDER_NOT_EMPTY",
        "Folder is not empty. Delete all contents first.",
      );
    }
    await deletePath(
      resolveSsdDiskPath(this.config.ssdStoragePath, folder.path),
      true,
    );
    await this.db.delete(folders).where(eq(folders.id, id));
    void removeStorageDocuments(this.meili, [id]).catch(console.error);
  }

  async listFiles(
    principal: StoragePrincipal,
    folderId: string | null,
    query: URLSearchParams,
  ) {
    if (!folderId) {
      throw new StorageServiceError(
        400,
        "MISSING_FOLDER_ID",
        "folderId query parameter is required",
      );
    }
    await this.getFolder(principal, folderId);
    const { page, limit, offset } = pagination(query, 100);
    const [items, countResult] = await Promise.all([
      this.db
        .select({
          id: files.id,
          filename: files.filename,
          path: files.path,
          mimeType: files.mimeType,
          sizeBytes: files.sizeBytes,
          tier: files.tier,
          createdAt: files.createdAt,
          updatedAt: files.updatedAt,
        })
        .from(files)
        .where(eq(files.folderId, folderId))
        .orderBy(desc(files.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(files)
        .where(eq(files.folderId, folderId)),
    ]);
    const total = countResult[0]?.count ?? 0;
    return {
      data: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getFile(
    principal: StoragePrincipal,
    id: string,
    scope: "storage:read" | "storage:write" | "storage:delete" = "storage:read",
    mode: "read" | "modify" = "read",
  ): Promise<StorageFile> {
    const file = await this.db.query.files.findFirst({
      where: eq(files.id, id),
    });
    if (!file) {
      throw new StorageServiceError(404, "FILE_NOT_FOUND", "File not found");
    }
    deny(principal, file.path, scope, file.ownerId, mode);
    return file;
  }

  async download(
    principal: StoragePrincipal,
    id: string,
    request: Request,
  ): Promise<Response> {
    const file = await this.getFile(principal, id);
    this.recordAccess(file);
    return this.fileResponse(file, request);
  }

  async updateFile(
    principal: StoragePrincipal,
    id: string,
    bodyValue: unknown,
  ) {
    const parsed = updateFileInputSchema.safeParse(bodyValue);
    if (!parsed.success) {
      throw new StorageServiceError(
        400,
        "NOTHING_TO_UPDATE",
        "Provide filename or folderId",
      );
    }
    const file = await this.getFile(principal, id, "storage:write", "modify");
    let filename = file.filename;
    try {
      if (parsed.data.filename) {
        filename = normalizeFileName(parsed.data.filename);
      }
    } catch (error) {
      if (error instanceof PathValidationError) {
        throw new StorageServiceError(400, "INVALID_NAME", error.message);
      }
      throw error;
    }
    let folderId = file.folderId;
    let folderPath = parentPath(file.path);
    if (parsed.data.folderId) {
      const target = await this.getFolder(principal, parsed.data.folderId);
      deny(
        principal,
        target.path,
        "storage:write",
        target.ownerId,
        isSharedPath(target.path) ? "read" : "modify",
      );
      folderId = target.id;
      folderPath = target.path;
    }
    const path = joinPath(folderPath, filename);
    if (path === file.path) {
      return { id, filename, path, folderId };
    }
    if (await this.db.query.files.findFirst({ where: eq(files.path, path) })) {
      throw new StorageServiceError(
        409,
        "FILE_EXISTS",
        "A file already exists at the target path",
      );
    }
    let diskPath = file.diskPath;
    if (file.tier === "ssd") {
      diskPath = resolveSsdDiskPath(this.config.ssdStoragePath, path);
      await ensureDir(dirname(diskPath));
      await rename(file.diskPath, diskPath);
    }
    try {
      await this.db
        .update(files)
        .set({ filename, path, folderId, diskPath, updatedAt: new Date() })
        .where(eq(files.id, id));
    } catch (error) {
      if (diskPath !== file.diskPath) {
        await rename(diskPath, file.diskPath).catch(console.error);
      }
      throw error;
    }
    void indexStorageDocuments(this.meili, [
      buildFileDocument({
        ...file,
        filename,
        path,
        folderId,
        updatedAt: new Date(),
      }),
    ]).catch(console.error);
    return { id, filename, path, folderId };
  }

  async deleteFile(principal: StoragePrincipal, id: string): Promise<void> {
    const file = await this.getFile(principal, id, "storage:delete", "modify");
    await deletePath(file.diskPath);
    await this.db.delete(files).where(eq(files.id, id));
    void removeStorageDocuments(this.meili, [id]).catch(console.error);
  }

  async createShare(
    principal: StoragePrincipal,
    id: string,
    bodyValue: unknown,
  ): Promise<string> {
    const body = safeJsonBody(bodyValue);
    const expires = shareExpiresInSchema.safeParse(body.expiresIn);
    if (!expires.success) {
      throw new StorageServiceError(
        400,
        "INVALID_EXPIRY",
        "expiresIn must be one of: 30m, 1d, 7d, 30d, never",
      );
    }
    await this.getFile(principal, id, "storage:read", "modify");
    return generateShareToken(id, expires.data, this.config.shareLinkSecret);
  }

  async sharedDownload(token: string, request: Request): Promise<Response> {
    const payload = verifyShareToken(token, this.config.shareLinkSecret);
    if (!payload) {
      throw new StorageServiceError(
        403,
        "INVALID_SHARE_LINK",
        "Invalid or expired share link",
      );
    }
    const file = await this.db.query.files.findFirst({
      where: eq(files.id, payload.fileId),
    });
    if (!file) {
      throw new StorageServiceError(404, "FILE_NOT_FOUND", "File not found");
    }
    this.recordAccess(file);
    return this.fileResponse(file, request);
  }

  async createUpload(
    principal: StoragePrincipal,
    request: Request,
  ): Promise<{ id: string; offset: number }> {
    const length = request.headers.get("Upload-Length");
    if (!length) {
      throw new StorageServiceError(
        400,
        "MISSING_UPLOAD_LENGTH",
        "Upload-Length header is required",
      );
    }
    if (!/^\d+$/.test(length)) {
      throw new StorageServiceError(
        400,
        "INVALID_UPLOAD_LENGTH",
        "Upload-Length must be a non-negative integer",
      );
    }
    const sizeBytes = Number(length);
    if (!Number.isSafeInteger(sizeBytes)) {
      throw new StorageServiceError(
        413,
        "UPLOAD_TOO_LARGE",
        "Upload-Length exceeds the supported size",
      );
    }
    const metadataHeader = request.headers.get("Upload-Metadata");
    if (!metadataHeader) {
      throw new StorageServiceError(
        400,
        "MISSING_METADATA",
        "Upload-Metadata header is required",
      );
    }
    const metadata = parseTusMetadata(metadataHeader);
    const filenameValue = metadata.filename;
    const targetFolder = metadata.targetFolder;
    if (!filenameValue) {
      throw new StorageServiceError(
        400,
        "MISSING_FILENAME",
        "filename is required in Upload-Metadata",
      );
    }
    if (!targetFolder) {
      throw new StorageServiceError(
        400,
        "MISSING_TARGET_FOLDER",
        "targetFolder is required in Upload-Metadata",
      );
    }
    try {
      validatePath(targetFolder);
    } catch (error) {
      if (error instanceof PathValidationError) {
        throw new StorageServiceError(400, "INVALID_PATH", error.message);
      }
      throw error;
    }
    const folder = await this.db.query.folders.findFirst({
      where: eq(folders.path, targetFolder),
    });
    if (!folder) {
      throw new StorageServiceError(
        404,
        "FOLDER_NOT_FOUND",
        "Target folder does not exist",
      );
    }
    deny(
      principal,
      folder.path,
      "storage:write",
      folder.ownerId,
      isSharedPath(folder.path) ? "read" : "modify",
    );
    let filename: string;
    try {
      filename = normalizeFileName(filenameValue);
    } catch (error) {
      if (error instanceof PathValidationError) {
        throw new StorageServiceError(400, "INVALID_NAME", error.message);
      }
      throw error;
    }
    const targetPath = joinPath(targetFolder, filename);
    if (
      await this.db.query.files.findFirst({
        where: eq(files.path, targetPath),
      })
    ) {
      throw new StorageServiceError(
        409,
        "FILE_EXISTS",
        "A file already exists at this path",
      );
    }
    const id = crypto.randomUUID();
    const tempDiskPath = join(this.config.tempUploadPath, `${id}.part`);
    await Bun.write(tempDiskPath, new Uint8Array());
    await this.db.insert(tusUploads).values({
      id,
      ownerId: principal.user.id,
      filename,
      targetPath,
      sizeBytes,
      mimeType: metadata.filetype || null,
      metadata,
      tempDiskPath,
      expiresAt: new Date(Date.now() + UPLOAD_EXPIRY_MS),
    });
    return { id, offset: 0 };
  }

  async uploadStatus(
    principal: StoragePrincipal,
    id: string,
  ): Promise<{ offset: number; length: number; status: string }> {
    const upload = await this.findUpload(principal, id);
    if (upload.status !== "in_progress") {
      throw new StorageServiceError(
        410,
        "UPLOAD_FINISHED",
        "Upload is no longer in progress",
      );
    }
    if (upload.bytesReceived === upload.sizeBytes) {
      void this.finalizeUpload(id).catch(console.error);
    }
    return {
      offset: upload.bytesReceived,
      length: upload.sizeBytes,
      status: upload.status,
    };
  }

  async uploadChunk(
    principal: StoragePrincipal,
    id: string,
    request: Request,
  ): Promise<number> {
    if (
      request.headers.get("Content-Type") !== "application/offset+octet-stream"
    ) {
      throw new StorageServiceError(
        415,
        "INVALID_CONTENT_TYPE",
        "Content-Type must be application/offset+octet-stream",
      );
    }
    const offsetText = request.headers.get("Upload-Offset");
    if (offsetText === null) {
      throw new StorageServiceError(
        400,
        "MISSING_OFFSET",
        "Upload-Offset header is required",
      );
    }
    if (!/^\d+$/.test(offsetText)) {
      throw new StorageServiceError(
        400,
        "INVALID_OFFSET",
        "Upload-Offset must be a non-negative integer",
      );
    }
    const clientOffset = Number(offsetText);
    if (!Number.isSafeInteger(clientOffset)) {
      throw new StorageServiceError(
        400,
        "INVALID_OFFSET",
        "Upload-Offset must be a non-negative integer",
      );
    }
    return this.withUploadLock(id, async () => {
      const upload = await this.findUpload(principal, id);
      if (upload.status !== "in_progress") {
        throw new StorageServiceError(
          410,
          "UPLOAD_FINISHED",
          "Upload is no longer in progress",
        );
      }
      if (new Date() > upload.expiresAt) {
        await this.db
          .update(tusUploads)
          .set({ status: "expired" })
          .where(eq(tusUploads.id, id));
        throw new StorageServiceError(
          410,
          "UPLOAD_EXPIRED",
          "Upload has expired",
        );
      }
      if (clientOffset !== upload.bytesReceived) {
        throw new StorageServiceError(
          409,
          "OFFSET_MISMATCH",
          `Expected offset ${upload.bytesReceived}, got ${clientOffset}`,
        );
      }
      if (!request.body) {
        throw new StorageServiceError(
          400,
          "EMPTY_BODY",
          "Request body is empty",
        );
      }
      const handle = await open(
        upload.tempDiskPath,
        clientOffset === 0 ? "w" : "r+",
      );
      let position = clientOffset;
      try {
        const reader = request.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          let offset = 0;
          while (offset < value.byteLength) {
            const { bytesWritten } = await handle.write(
              value,
              offset,
              value.byteLength - offset,
              position,
            );
            offset += bytesWritten;
            position += bytesWritten;
          }
          if (position > upload.sizeBytes) break;
        }
      } finally {
        await handle.close();
      }
      await fsyncFile(upload.tempDiskPath);
      if (position > upload.sizeBytes) {
        await deletePath(upload.tempDiskPath);
        await this.db
          .update(tusUploads)
          .set({ status: "expired" })
          .where(eq(tusUploads.id, id));
        throw new StorageServiceError(
          413,
          "SIZE_EXCEEDED",
          "Upload exceeded declared size",
        );
      }
      await this.db
        .update(tusUploads)
        .set({ bytesReceived: position, updatedAt: new Date() })
        .where(
          and(
            eq(tusUploads.id, id),
            eq(tusUploads.bytesReceived, clientOffset),
          ),
        );
      if (position === upload.sizeBytes) {
        await this.finalizeUpload(id);
      }
      return position;
    });
  }

  async cancelUpload(principal: StoragePrincipal, id: string): Promise<void> {
    const upload = await this.findUpload(principal, id);
    await deletePath(upload.tempDiskPath);
    await this.db.delete(tusUploads).where(eq(tusUploads.id, id));
  }

  async cleanupExpiredUploads(now = new Date()): Promise<number> {
    const expired = await this.db
      .select({ id: tusUploads.id, tempDiskPath: tusUploads.tempDiskPath })
      .from(tusUploads)
      .where(
        and(
          eq(tusUploads.status, "in_progress"),
          sql`${tusUploads.expiresAt} < ${now}`,
        ),
      );
    for (const upload of expired) {
      await deletePath(upload.tempDiskPath);
      await this.db
        .update(tusUploads)
        .set({ status: "expired" })
        .where(eq(tusUploads.id, upload.id));
    }
    return expired.length;
  }

  async archive(
    principal: StoragePrincipal,
    bodyValue: unknown,
  ): Promise<Response> {
    const parsed = downloadArchiveInputSchema.safeParse(bodyValue);
    if (!parsed.success) {
      throw new StorageServiceError(
        400,
        "INVALID_ARCHIVE_SELECTION",
        "At least one valid file or folder id is required",
      );
    }
    const selected = new Map<string, StorageFile>();
    if (parsed.data.fileIds.length > 0) {
      const direct = await this.db
        .select()
        .from(files)
        .where(inArray(files.id, parsed.data.fileIds));
      if (direct.length !== new Set(parsed.data.fileIds).size) {
        throw new StorageServiceError(
          404,
          "FILE_NOT_FOUND",
          "One or more files were not found",
        );
      }
      for (const file of direct) selected.set(file.id, file);
    }
    for (const folderId of parsed.data.folderIds) {
      const folder = await this.getFolder(principal, folderId);
      const descendants = await this.db
        .select()
        .from(files)
        .where(like(files.path, descendantPattern(folder.path)));
      for (const file of descendants) selected.set(file.id, file);
    }
    let total = 0;
    const entries: ArchiveEntry[] = [];
    for (const file of selected.values()) {
      deny(principal, file.path, "storage:read", file.ownerId, "read");
      total += file.sizeBytes;
      if (total > this.config.archiveMaxBytes) {
        throw new StorageServiceError(
          413,
          "ARCHIVE_TOO_LARGE",
          `Archive exceeds the ${this.config.archiveMaxBytes} byte limit`,
        );
      }
      const segments = file.path.split("/").filter(Boolean);
      entries.push({
        name: segments.slice(1).join("/") || file.filename,
        diskPath: file.diskPath,
        size: file.sizeBytes,
        modifiedAt: file.updatedAt,
      });
    }
    if (entries.length === 0) {
      throw new StorageServiceError(
        400,
        "EMPTY_ARCHIVE",
        "The selected folders contain no files",
      );
    }
    return new Response(createZipStream(entries), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition(
          "attachment",
          "deniz-cloud-files.zip",
        ),
      },
    });
  }

  async search(principal: StoragePrincipal, query: URLSearchParams) {
    const text = query.get("q")?.trim();
    if (!text || text.length < 2) {
      throw new StorageServiceError(
        400,
        "QUERY_TOO_SHORT",
        "Search query must be at least 2 characters",
      );
    }
    const scope = query.get("scope") === "shared" ? "shared" : "user";
    if (principal.project && scope === "shared") {
      throw new StorageServiceError(
        403,
        "ACCESS_DENIED",
        "Project API keys cannot search shared storage",
      );
    }
    const { page, limit } = pagination(query, 50);
    const result = await searchStorageIndex(this.meili, text, {
      scope,
      ownerId: scope === "user" ? principal.user.id : undefined,
      rootPath: principal.project ? `/${principal.project.slug}` : undefined,
      page,
      hitsPerPage: limit,
    });
    const hits = result.hits.map(({ rootPath: _rootPath, ...hit }) => hit);
    return {
      data: { hits },
      pagination: {
        page: result.page,
        limit,
        total: result.totalHits,
        totalPages: result.totalPages,
      },
    };
  }

  async reindex(principal: StoragePrincipal): Promise<number> {
    if (principal.user.role !== "superuser" || principal.project) {
      throw new StorageServiceError(
        403,
        "FORBIDDEN",
        "Only superusers can trigger reindex",
      );
    }
    const index = this.meili.index(STORAGE_INDEX_UID);
    await index.deleteAllDocuments().waitTask();
    const [allFiles, allFolders] = await Promise.all([
      this.db.select().from(files),
      this.db.select().from(folders).where(ne(folders.parentId, folders.id)),
    ]);
    const documents = [
      ...allFiles.map(buildFileDocument),
      ...allFolders.map(buildFolderDocument).filter((value) => value !== null),
    ];
    for (let offset = 0; offset < documents.length; offset += 1000) {
      await index
        .addDocuments(documents.slice(offset, offset + 1000))
        .waitTask();
    }
    return documents.length;
  }

  private recordAccess(file: StorageFile): void {
    void this.db
      .update(files)
      .set({
        lastAccessedAt: new Date(),
        accessCount: sql`${files.accessCount} + 1`,
      })
      .where(eq(files.id, file.id))
      .catch(console.error);
    if (file.tier === "hdd") this.promotions.enqueue(file.id);
  }

  private fileResponse(file: StorageFile, request: Request): Response {
    const url = new URL(request.url);
    const forceDownload = url.searchParams.has("download");
    const headers = new Headers({
      "Content-Type": file.mimeType ?? "application/octet-stream",
      "Content-Disposition": contentDisposition(
        forceDownload ? "attachment" : "inline",
        file.filename,
      ),
      "Accept-Ranges": "bytes",
    });
    const range = request.headers.get("Range");
    if (!range) {
      headers.set("Content-Length", String(file.sizeBytes));
      return new Response(Bun.file(file.diskPath), { headers });
    }
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${file.sizeBytes}` },
      });
    }
    let start: number;
    let end: number;
    if (!match[1]) {
      const suffix = Number.parseInt(match[2] ?? "", 10);
      if (suffix <= 0) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${file.sizeBytes}` },
        });
      }
      start = Math.max(0, file.sizeBytes - suffix);
      end = file.sizeBytes - 1;
    } else {
      start = Number.parseInt(match[1], 10);
      end = match[2] ? Number.parseInt(match[2], 10) : file.sizeBytes - 1;
    }
    if (start >= file.sizeBytes || start > end) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${file.sizeBytes}` },
      });
    }
    end = Math.min(end, file.sizeBytes - 1);
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Content-Range", `bytes ${start}-${end}/${file.sizeBytes}`);
    return new Response(fileRangeStream(file.diskPath, start, end), {
      status: 206,
      headers,
    });
  }

  private async findUpload(principal: StoragePrincipal, id: string) {
    const upload = await this.db.query.tusUploads.findFirst({
      where: and(
        eq(tusUploads.id, id),
        eq(tusUploads.ownerId, principal.user.id),
      ),
    });
    if (!upload) {
      throw new StorageServiceError(
        404,
        "UPLOAD_NOT_FOUND",
        "Upload not found",
      );
    }
    deny(
      principal,
      upload.targetPath,
      "storage:write",
      upload.ownerId,
      "modify",
    );
    return upload;
  }

  private async finalizeUpload(id: string): Promise<void> {
    const upload = await this.db.query.tusUploads.findFirst({
      where: eq(tusUploads.id, id),
    });
    if (
      upload?.status !== "in_progress" ||
      upload.bytesReceived !== upload.sizeBytes
    ) {
      return;
    }
    const checksum = await computeChecksum(upload.tempDiskPath);
    const stats = await getDiskStats(this.config.ssdStoragePath).catch(
      () => null,
    );
    const tier =
      upload.sizeBytes >= this.config.tiering.minSizeBytes ||
      (stats && stats.usagePercent >= this.config.tiering.highWatermarkPercent)
        ? "hdd"
        : "ssd";
    const fileId = crypto.randomUUID();
    const finalDiskPath =
      tier === "ssd"
        ? resolveSsdDiskPath(this.config.ssdStoragePath, upload.targetPath)
        : resolveHddDiskPath(this.config.hddStoragePath, fileId);
    if (await pathExists(finalDiskPath)) {
      throw new StorageServiceError(
        409,
        "FILE_EXISTS",
        "A file already exists at the target path",
      );
    }
    await copyAndVerify(upload.tempDiskPath, finalDiskPath, checksum);
    const folder = await this.db.query.folders.findFirst({
      where: eq(folders.path, parentPath(upload.targetPath)),
    });
    if (!folder) {
      await deletePath(finalDiskPath);
      throw new Error("Upload parent folder no longer exists");
    }
    const now = new Date();
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(files).values({
          id: fileId,
          ownerId: upload.ownerId,
          folderId: folder.id,
          filename: upload.filename,
          path: upload.targetPath,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          checksum,
          tier,
          diskPath: finalDiskPath,
        });
        await tx
          .update(tusUploads)
          .set({ status: "completed", updatedAt: now })
          .where(
            and(
              eq(tusUploads.id, upload.id),
              eq(tusUploads.status, "in_progress"),
            ),
          );
      });
    } catch (error) {
      await deletePath(finalDiskPath);
      throw error;
    }
    await deletePath(upload.tempDiskPath);
    void indexStorageDocuments(this.meili, [
      buildFileDocument({
        id: fileId,
        filename: upload.filename,
        path: upload.targetPath,
        ownerId: upload.ownerId,
        folderId: folder.id,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        tier,
        createdAt: now,
        updatedAt: now,
      }),
    ]).catch(console.error);
  }

  private async withUploadLock<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const prior = this.#uploadLocks.get(id) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = prior.then(() => current);
    this.#uploadLocks.set(id, queued);
    await prior;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.#uploadLocks.get(id) === queued) this.#uploadLocks.delete(id);
    }
  }

  private async findFolder(id: string): Promise<Folder> {
    const folder = await this.db.query.folders.findFirst({
      where: eq(folders.id, id),
    });
    if (!folder) {
      throw new StorageServiceError(
        404,
        "FOLDER_NOT_FOUND",
        "Folder not found",
      );
    }
    return folder;
  }

  private async reindexPath(path: string): Promise<void> {
    try {
      const [folderRows, fileRows] = await Promise.all([
        this.db
          .select()
          .from(folders)
          .where(
            or(
              eq(folders.path, path),
              like(folders.path, descendantPattern(path)),
            ),
          ),
        this.db
          .select()
          .from(files)
          .where(like(files.path, descendantPattern(path))),
      ]);
      const documents = [
        ...folderRows
          .map(buildFolderDocument)
          .filter((value) => value !== null),
        ...fileRows.map(buildFileDocument),
      ];
      await indexStorageDocuments(this.meili, documents);
    } catch (error) {
      console.error("Failed to sync storage path to search index", error);
    }
  }
}

export { TUS_VERSION };
