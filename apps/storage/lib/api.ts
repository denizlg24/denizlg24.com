import { toApiError, toTransportError } from "@repo/cloud-ui/api-error";
import {
  type ArchiveJob,
  archiveJobSchema,
  type CompleteSignupInput,
  type CompleteSignupResult,
  type CreateFolderInput,
  type CreateShareLinkInput,
  completeSignupResultSchema,
  type DeletedFolder,
  type DownloadArchiveInput,
  deletedFolderSchema,
  type FolderContents,
  folderContentsSchema,
  type IssuedSmbCredentialResponse,
  issuedSmbCredentialSchema,
  type Pagination,
  paginationSchema,
  type RecentFile,
  type RenamedFolder,
  type RootFolders,
  recentFileSchema,
  renamedFolderSchema,
  rootFoldersSchema,
  type SafeUser,
  type SearchResults,
  type SharedContents,
  type SharedMeta,
  type ShareLinkToken,
  type SmbCredential,
  type StorageFileDetail,
  type StorageFolder,
  type StorageFolderDetail,
  type StoragePerson,
  type StorageShare,
  type StorageUsage,
  safeUserSchema,
  searchResultsSchema,
  sharedContentsSchema,
  sharedMetaSchema,
  shareLinkTokenSchema,
  smbCredentialSchema,
  storageFileDetailSchema,
  storageFolderDetailSchema,
  storagePersonSchema,
  storageShareSchema,
  storageUsageSchema,
  type UpdatedFile,
  type UpdatedShare,
  type UpdateFileInput,
  type UpdateFolderInput,
  type UpdateShareInput,
  updatedFileSchema,
  updatedShareSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { API_BASE_URL } from "./env";

export {
  ApiError,
  errorMessage,
  isApiError,
  isUnreachable,
} from "@repo/cloud-ui/api-error";

type QueryValue = string | number | boolean | undefined;
type Query = Record<string, QueryValue>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Lets the request outlive the page. Set when committing a pending delete
   * during pagehide, where a normal fetch is cancelled with the document and
   * the delete would be lost with no error anywhere.
   */
  keepalive?: boolean;
}

// Without a deadline a stalled connection leaves the browser stuck on a
// skeleton with no way back.
const DEFAULT_TIMEOUT_MS = 30_000;
// Starting an archive walks every selected file's row before it answers.
const ARCHIVE_TIMEOUT_MS = 60_000;

function sharePath(token: string): string {
  return `/api/storage/share/${encodeURIComponent(token)}`;
}

function buildUrl(path: string, query?: Query): URL {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

function timeoutSignal(
  timeoutMs: number,
  signal: AbortSignal | undefined,
): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([deadline, signal]) : deadline;
}

async function rawFetch(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      credentials: "include",
      keepalive: options.keepalive,
      signal: timeoutSignal(
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        options.signal,
      ),
      headers:
        options.body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    // A caller-supplied signal aborting is a deliberate cancellation, not a
    // transport failure — it must not be reported as the Pi being down.
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw toTransportError(error);
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

async function rawRequest(
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  return (await rawFetch(path, options)).json();
}

/**
 * The last validated body per URL, for conditional GETs.
 *
 * A folder on screen is re-read every fifteen seconds. Sending the ETag the
 * server last gave for that exact URL lets an unchanged folder answer 304 with
 * no body, and the body it validated is replayed from here. Bounded because
 * every folder ever opened would otherwise stay in memory for the session.
 */
const validated = new Map<string, { etag: string; body: unknown }>();
const VALIDATED_MAX = 200;

async function rawConditionalRequest(
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  const url = buildUrl(path, options.query);
  const key = url.toString();
  const known = validated.get(key);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "include",
      signal: timeoutSignal(
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        options.signal,
      ),
      headers: known ? { "If-None-Match": known.etag } : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw toTransportError(error);
  }
  if (response.status === 304 && known) return known.body;
  if (!response.ok) throw await toApiError(response);
  const body: unknown = await response.json();
  const etag = response.headers.get("ETag");
  if (etag) {
    validated.delete(key);
    validated.set(key, { body, etag });
    if (validated.size > VALIDATED_MAX) {
      const oldest = validated.keys().next().value;
      if (oldest !== undefined) validated.delete(oldest);
    }
  }
  return body;
}

const envelopeSchema = z.object({ data: z.unknown() });

async function requestData<T extends z.ZodType>(
  schema: T,
  path: string,
  options: RequestOptions = {},
): Promise<z.output<T>> {
  const payload = await rawRequest(path, options);
  return schema.parse(envelopeSchema.parse(payload).data);
}

export interface Paged<T> {
  data: T;
  pagination: Pagination;
}

async function requestPaged<T extends z.ZodType>(
  schema: T,
  path: string,
  options: RequestOptions & { conditional?: boolean } = {},
): Promise<Paged<z.output<T>>> {
  const payload = options.conditional
    ? await rawConditionalRequest(path, options)
    : await rawRequest(path, options);
  const parsed = z
    .object({ data: z.unknown(), pagination: paginationSchema })
    .parse(payload);
  return { data: schema.parse(parsed.data), pagination: parsed.pagination };
}

export const api = {
  me: (): Promise<SafeUser> => requestData(safeUserSchema, "/api/me"),

  completeSignup: (input: CompleteSignupInput): Promise<CompleteSignupResult> =>
    requestData(completeSignupResultSchema, "/api/auth/complete-signup", {
      method: "POST",
      body: input,
    }),

  roots: (): Promise<RootFolders> =>
    requestData(rootFoldersSchema, "/api/storage/folders/roots"),

  recent: (limit = 100): Promise<RecentFile[]> =>
    requestData(z.array(recentFileSchema), "/api/storage/recent", {
      query: { limit },
    }),

  people: (): Promise<StoragePerson[]> =>
    requestData(z.array(storagePersonSchema), "/api/storage/people"),

  usage: (): Promise<StorageUsage> =>
    requestData(storageUsageSchema, "/api/storage/usage"),

  folder: (id: string): Promise<StorageFolderDetail> =>
    requestData(storageFolderDetailSchema, `/api/storage/folders/${id}`),

  folderContents: (
    id: string,
    query?: { page?: number; limit?: number },
    options?: { signal?: AbortSignal },
  ): Promise<Paged<FolderContents>> =>
    requestPaged(folderContentsSchema, `/api/storage/folders/${id}/contents`, {
      conditional: true,
      query,
      signal: options?.signal,
    }),

  /** Subfolders only, for the tree and the move picker. No file page is read. */
  folderChildren: (
    id: string,
    options?: { signal?: AbortSignal },
  ): Promise<StorageFolder[]> =>
    requestPaged(folderContentsSchema, `/api/storage/folders/${id}/contents`, {
      conditional: true,
      query: { include: "folders" },
      signal: options?.signal,
    }).then((result) => result.data.subfolders),

  createFolder: (input: CreateFolderInput): Promise<RenamedFolder> =>
    requestData(renamedFolderSchema, "/api/storage/folders", {
      method: "POST",
      body: input,
    }),

  updateFolder: (
    id: string,
    input: UpdateFolderInput,
  ): Promise<RenamedFolder> =>
    requestData(renamedFolderSchema, `/api/storage/folders/${id}`, {
      method: "PATCH",
      body: input,
    }),

  // No default: a recursive folder delete is the most destructive call in this
  // client, so every call site has to say so out loud.
  deleteFolder: (
    id: string,
    recursive: boolean,
    keepalive = false,
  ): Promise<DeletedFolder> =>
    requestData(deletedFolderSchema, `/api/storage/folders/${id}`, {
      method: "DELETE",
      keepalive,
      query: { recursive },
    }),

  file: (id: string): Promise<StorageFileDetail> =>
    requestData(storageFileDetailSchema, `/api/storage/files/${id}`),

  updateFile: (id: string, input: UpdateFileInput): Promise<UpdatedFile> =>
    requestData(updatedFileSchema, `/api/storage/files/${id}`, {
      method: "PATCH",
      body: input,
    }),

  deleteFile: (id: string, keepalive = false): Promise<{ id: string }> =>
    requestData(z.object({ id: z.uuid() }), `/api/storage/files/${id}`, {
      method: "DELETE",
      keepalive,
    }),

  /** The signed-in side of sharing: links this account has made. */
  shares: {
    create: (
      target: { kind: "file" | "folder"; id: string },
      input: CreateShareLinkInput,
    ): Promise<ShareLinkToken> =>
      requestData(
        shareLinkTokenSchema,
        `/api/storage/${target.kind === "file" ? "files" : "folders"}/${target.id}/share`,
        { method: "POST", body: input },
      ),
    /** `owner: "all"` is superuser-only and lists every account's links. */
    list: (owner?: "all"): Promise<StorageShare[]> =>
      requestData(z.array(storageShareSchema), "/api/storage/shares", {
        query: { owner },
      }),
    update: (id: string, input: UpdateShareInput): Promise<UpdatedShare> =>
      requestData(updatedShareSchema, `/api/storage/shares/${id}`, {
        method: "PATCH",
        body: input,
      }),
    remove: (id: string): Promise<{ id: string }> =>
      requestData(z.object({ id: z.string() }), `/api/storage/shares/${id}`, {
        method: "DELETE",
      }),
  },

  smbCredentials: {
    list: (): Promise<SmbCredential[]> =>
      requestData(z.array(smbCredentialSchema), "/api/storage/smb-credentials"),
    issue: (deviceName: string): Promise<IssuedSmbCredentialResponse> =>
      requestData(issuedSmbCredentialSchema, "/api/storage/smb-credentials", {
        method: "POST",
        body: { deviceName },
      }),
    revoke: (id: string): Promise<{ id: string }> =>
      requestData(
        z.object({ id: z.uuid() }),
        `/api/storage/smb-credentials/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
  },

  /**
   * The recipient's side: no session, the token is the whole credential. A
   * password share hands back a cookie on unlock, which the browser then
   * sends with every other call here on its own.
   */
  shared: {
    meta: (token: string): Promise<SharedMeta> =>
      requestData(sharedMetaSchema, `${sharePath(token)}/meta`),
    unlock: (token: string, password: string): Promise<void> =>
      rawRequest(`${sharePath(token)}/unlock`, {
        method: "POST",
        body: { password },
      }).then(() => undefined),
    contents: (
      token: string,
      query?: { folderId?: string; page?: number; limit?: number },
      options?: { signal?: AbortSignal },
    ): Promise<Paged<SharedContents>> =>
      requestPaged(sharedContentsSchema, `${sharePath(token)}/contents`, {
        query,
        signal: options?.signal,
      }),
    archive: (token: string, signal?: AbortSignal): Promise<ArchiveJob> =>
      requestData(archiveJobSchema, `${sharePath(token)}/archive`, {
        method: "POST",
        timeoutMs: ARCHIVE_TIMEOUT_MS,
        signal,
      }),
    archiveStatus: (
      token: string,
      jobId: string,
      signal?: AbortSignal,
    ): Promise<ArchiveJob> =>
      requestData(archiveJobSchema, `${sharePath(token)}/archive/${jobId}`, {
        signal,
      }),
  },

  search: (query: {
    q: string;
    scope?: "user" | "shared" | "all";
    page?: number;
    limit?: number;
  }): Promise<Paged<SearchResults>> =>
    requestPaged(searchResultsSchema, "/api/search", { query }),

  archive: (
    input: DownloadArchiveInput,
    signal?: AbortSignal,
  ): Promise<ArchiveJob> =>
    requestData(archiveJobSchema, "/api/storage/download-archive", {
      method: "POST",
      body: input,
      timeoutMs: ARCHIVE_TIMEOUT_MS,
      signal,
    }),

  archiveStatus: (id: string, signal?: AbortSignal): Promise<ArchiveJob> =>
    requestData(archiveJobSchema, `/api/storage/download-archive/${id}`, {
      signal,
    }),

  /** Direct URLs for `<img>`/`<video>`/`<iframe>` and browser downloads. */
  url: {
    file: (id: string): string =>
      buildUrl(`/api/storage/files/${id}/download`).toString(),
    /** `v` is the file's version (updatedAt) so a modified file is a new URL. */
    thumbnail: (id: string, width: 256 | 512 | 1024, version: string): string =>
      buildUrl(`/api/storage/files/${id}/thumbnail`, {
        w: width,
        v: new Date(version).getTime(),
      }).toString(),
    fileDownload: (id: string): string =>
      buildUrl(`/api/storage/files/${id}/download`, {
        download: "1",
      }).toString(),
    archiveDownload: (id: string): string =>
      buildUrl(`/api/storage/download-archive/${id}/download`).toString(),

    /** A file share's own bytes. */
    shared: (token: string): string => buildUrl(sharePath(token)).toString(),
    sharedDownload: (token: string): string =>
      buildUrl(sharePath(token), { download: "1" }).toString(),
    sharedThumbnail: (
      token: string,
      width: 256 | 512 | 1024,
      version: string,
    ): string =>
      buildUrl(`${sharePath(token)}/thumbnail`, {
        w: width,
        v: new Date(version).getTime(),
      }).toString(),
    /** A file inside a folder share. */
    sharedFile: (token: string, fileId: string): string =>
      buildUrl(`${sharePath(token)}/files/${fileId}`).toString(),
    sharedFileDownload: (token: string, fileId: string): string =>
      buildUrl(`${sharePath(token)}/files/${fileId}`, {
        download: "1",
      }).toString(),
    sharedFileThumbnail: (
      token: string,
      fileId: string,
      width: 256 | 512 | 1024,
      version: string,
    ): string =>
      buildUrl(`${sharePath(token)}/files/${fileId}/thumbnail`, {
        w: width,
        v: new Date(version).getTime(),
      }).toString(),
    sharedArchiveDownload: (token: string, jobId: string): string =>
      buildUrl(`${sharePath(token)}/archive/${jobId}/download`).toString(),
  },

  /**
   * Fetches a file body directly — used by the text/code/pdf previews.
   *
   * `maxBytes` asks for a leading range instead of the whole body, which is how
   * the unknown-type probe reads enough of a file to tell text from binary
   * without pulling a gigabyte through the browser. A 206 is a success here; a
   * server that ignores the range simply answers 200 with everything.
   */
  fetchFile: (
    url: string,
    signal?: AbortSignal,
    maxBytes?: number,
  ): Promise<Response> =>
    fetch(url, {
      credentials: "include",
      signal,
      headers: maxBytes ? { Range: `bytes=0-${maxBytes - 1}` } : undefined,
    }).then(async (response) => {
      if (!response.ok) throw await toApiError(response);
      return response;
    }),
};
