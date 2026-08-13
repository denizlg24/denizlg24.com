import { toApiError, toTransportError } from "@repo/cloud-ui/api-error";
import {
  type ArchiveJob,
  archiveJobSchema,
  type CompleteSignupInput,
  type CompleteSignupResult,
  type CreateFolderInput,
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
  type RenamedFolder,
  type RootFolders,
  renamedFolderSchema,
  rootFoldersSchema,
  type SafeUser,
  type SearchResults,
  type SharedFileMeta,
  type ShareLinkToken,
  type SmbCredential,
  type StorageFileDetail,
  type StorageFolderDetail,
  safeUserSchema,
  searchResultsSchema,
  sharedFileMetaSchema,
  shareLinkTokenSchema,
  smbCredentialSchema,
  storageFileDetailSchema,
  storageFolderDetailSchema,
  type UpdatedFile,
  type UpdateFileInput,
  type UpdateFolderInput,
  updatedFileSchema,
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
  options: RequestOptions = {},
): Promise<Paged<z.output<T>>> {
  const payload = await rawRequest(path, options);
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

  folder: (id: string): Promise<StorageFolderDetail> =>
    requestData(storageFolderDetailSchema, `/api/storage/folders/${id}`),

  folderContents: (
    id: string,
    query?: { page?: number; limit?: number },
  ): Promise<Paged<FolderContents>> =>
    requestPaged(folderContentsSchema, `/api/storage/folders/${id}/contents`, {
      query,
    }),

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

  createShare: (id: string, expiresIn: string): Promise<ShareLinkToken> =>
    requestData(shareLinkTokenSchema, `/api/storage/files/${id}/share`, {
      method: "POST",
      body: { expiresIn },
    }),

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

  sharedMeta: (token: string): Promise<SharedFileMeta> =>
    requestData(
      sharedFileMetaSchema,
      `/api/storage/share/${encodeURIComponent(token)}/meta`,
    ),

  search: (query: {
    q: string;
    scope?: "user" | "shared";
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
    fileDownload: (id: string): string =>
      buildUrl(`/api/storage/files/${id}/download`, {
        download: "1",
      }).toString(),
    shared: (token: string): string =>
      buildUrl(`/api/storage/share/${encodeURIComponent(token)}`).toString(),
    sharedDownload: (token: string): string =>
      buildUrl(`/api/storage/share/${encodeURIComponent(token)}`, {
        download: "1",
      }).toString(),
    archiveDownload: (id: string): string =>
      buildUrl(`/api/storage/download-archive/${id}/download`).toString(),
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
