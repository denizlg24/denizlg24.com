import {
  apiErrorResponseSchema,
  type CompleteSignupInput,
  type CompleteSignupResult,
  type CreateFolderInput,
  completeSignupResultSchema,
  type DeletedFolder,
  type DownloadArchiveInput,
  deletedFolderSchema,
  type FolderContents,
  folderContentsSchema,
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
  type StorageFileDetail,
  type StorageFolderDetail,
  safeUserSchema,
  searchResultsSchema,
  sharedFileMetaSchema,
  shareLinkTokenSchema,
  storageFileDetailSchema,
  storageFolderDetailSchema,
  type UpdatedFile,
  type UpdateFileInput,
  type UpdateFolderInput,
  updatedFileSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { API_BASE_URL } from "./env";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

type QueryValue = string | number | boolean | undefined;
type Query = Record<string, QueryValue>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  timeoutMs?: number;
  signal?: AbortSignal;
}

// Without a deadline a stalled connection leaves the browser stuck on a
// skeleton with no way back.
const DEFAULT_TIMEOUT_MS = 30_000;
// Building a ZIP walks every selected file on disk before the first byte.
const ARCHIVE_TIMEOUT_MS = 10 * 60_000;

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

async function toApiError(response: Response): Promise<ApiError> {
  const payload = await response.json().catch(() => null);
  const parsed = apiErrorResponseSchema.safeParse(payload);
  if (parsed.success) {
    return new ApiError(
      parsed.data.error.code,
      parsed.data.error.message,
      response.status,
    );
  }
  return new ApiError(
    response.status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR",
    `Request failed (${response.status})`,
    response.status,
  );
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
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError("TIMEOUT", "The server took too long to respond", 0);
    }
    throw new ApiError("NETWORK", "Can't reach the server", 0);
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

  deleteFolder: (id: string, recursive = true): Promise<DeletedFolder> =>
    requestData(deletedFolderSchema, `/api/storage/folders/${id}`, {
      method: "DELETE",
      query: { recursive },
    }),

  file: (id: string): Promise<StorageFileDetail> =>
    requestData(storageFileDetailSchema, `/api/storage/files/${id}`),

  updateFile: (id: string, input: UpdateFileInput): Promise<UpdatedFile> =>
    requestData(updatedFileSchema, `/api/storage/files/${id}`, {
      method: "PATCH",
      body: input,
    }),

  deleteFile: (id: string): Promise<{ id: string }> =>
    requestData(z.object({ id: z.uuid() }), `/api/storage/files/${id}`, {
      method: "DELETE",
    }),

  createShare: (id: string, expiresIn: string): Promise<ShareLinkToken> =>
    requestData(shareLinkTokenSchema, `/api/storage/files/${id}/share`, {
      method: "POST",
      body: { expiresIn },
    }),

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
  ): Promise<Response> =>
    rawFetch("/api/storage/download-archive", {
      method: "POST",
      body: input,
      timeoutMs: ARCHIVE_TIMEOUT_MS,
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
  },

  /** Fetches a file body directly — used by the text/code/pdf previews. */
  fetchFile: (url: string, signal?: AbortSignal): Promise<Response> =>
    fetch(url, { credentials: "include", signal }).then(async (response) => {
      if (!response.ok) throw await toApiError(response);
      return response;
    }),
};
