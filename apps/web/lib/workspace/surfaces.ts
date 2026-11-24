import type { MCPClient } from "@ai-sdk/mcp";
import {
  SURFACE_ASSET_MAX_BYTES,
  SURFACE_ASSETS_MAX,
  SURFACE_CODE_MAX,
  SURFACE_ERRORS_MAX,
  SURFACE_HEAD_MAX,
  type SurfaceAsset,
  type SurfaceAssetAdd,
  type SurfaceCall,
  type SurfaceCallResult,
  type SurfaceError,
  type SurfaceInput,
  type SurfaceMount,
  type SurfacePatch,
  type SurfaceRevision,
  type SurfaceSourceRequest,
  type SurfaceState,
  surfaceInputSchema,
  surfacePatchSchema,
  surfaceStateSchema,
  type WorkspaceSurface,
  type WorkspaceSurfaceSummary,
  workspaceSurfaceSchema,
  workspaceSurfaceSummarySchema,
} from "@repo/schemas";
import mongoose, {
  type ClientSession,
  type QueryFilter,
  Types,
} from "mongoose";
import { uploadFileToStorage } from "@/lib/storage-api";
import {
  type IWorkspaceSurface,
  WorkspaceSurfaceModel,
} from "@/models/WorkspaceSurface";
import {
  type IWorkspaceSurfaceRevision,
  WorkspaceSurfaceRevisionModel,
} from "@/models/WorkspaceSurfaceRevision";
import { type WorkspaceCaller, WorkspaceError } from "./service";
import {
  editSurfaceSource,
  readSurfaceSource,
  SOURCE_FIELDS,
  searchSurfaceSource,
} from "./surface-source";
import { fetchGuarded, UnfurlRefused } from "./unfurl";

const CODE_FIELDS = [
  "name",
  "description",
  "icon",
  "head",
  "html",
  "css",
  "js",
  "chrome",
] as const;

type CodeField = (typeof CODE_FIELDS)[number];
type CodeSnapshot = Pick<WorkspaceSurface, CodeField>;

const ASSET_FETCH_TIMEOUT_MS = 20_000;

function surfaceOf(doc: IWorkspaceSurface): WorkspaceSurface | null {
  const parsed = workspaceSurfaceSchema.safeParse({
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    icon: doc.icon,
    head: doc.head,
    html: doc.html,
    css: doc.css,
    js: doc.js,
    chrome: doc.chrome,
    mount: doc.mount,
    assets: doc.assets,
    state: doc.state,
    errors: doc.frameErrors,
    rev: doc.rev,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

function notFound(id: string): WorkspaceError {
  return new WorkspaceError(404, "NOT_FOUND", `Surface ${id} not found`);
}

function snapshotOf(surface: CodeSnapshot): CodeSnapshot {
  return {
    name: surface.name,
    description: surface.description,
    icon: surface.icon,
    head: surface.head,
    html: surface.html,
    css: surface.css,
    js: surface.js,
    chrome: surface.chrome,
  };
}

function changedFields(before: CodeSnapshot, after: CodeSnapshot): CodeField[] {
  return CODE_FIELDS.filter((field) => before[field] !== after[field]);
}

interface SummaryRow {
  _id: Types.ObjectId;
  name: string;
  description: string;
  icon: string | null;
  chrome: string;
  mount: SurfaceMount;
  rev: number;
  createdBy: string;
  updatedAt: Date;
  errorCount: number;
}

export async function listSurfaces(): Promise<WorkspaceSurfaceSummary[]> {
  const rows = await WorkspaceSurfaceModel.aggregate<SummaryRow>([
    { $sort: { name: 1 } },
    {
      $project: {
        name: 1,
        description: 1,
        icon: 1,
        chrome: 1,
        mount: 1,
        rev: 1,
        createdBy: 1,
        updatedAt: 1,
        errorCount: { $size: { $ifNull: ["$frameErrors", []] } },
      },
    },
  ]).exec();
  return rows.flatMap((row) => {
    const parsed = workspaceSurfaceSummarySchema.safeParse({
      id: row._id.toString(),
      name: row.name,
      description: row.description,
      icon: row.icon,
      chrome: row.chrome,
      mount: row.mount,
      rev: row.rev,
      createdBy: row.createdBy,
      updatedAt: row.updatedAt.toISOString(),
      errorCount: row.errorCount,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

export async function getSurface(id: string): Promise<WorkspaceSurface> {
  if (!Types.ObjectId.isValid(id)) throw notFound(id);
  const doc = await WorkspaceSurfaceModel.findById(id)
    .lean<IWorkspaceSurface>()
    .exec();
  const surface = doc ? surfaceOf(doc) : null;
  if (!surface) throw notFound(id);
  return surface;
}

async function unmountOthers(
  id: string | null,
  mount: SurfaceMount,
): Promise<void> {
  if (mount.kind === "none") return;
  const holder: QueryFilter<IWorkspaceSurface> =
    mount.kind === "home"
      ? { "mount.kind": "home" }
      : { "mount.kind": "module", "mount.module": mount.module };
  await WorkspaceSurfaceModel.updateMany(
    { ...holder, ...(id ? { _id: { $ne: id } } : {}) },
    { $set: { mount: { kind: "none" } } },
  ).exec();
}

async function writeRevision(
  surfaceId: string,
  rev: number,
  actor: string,
  changed: string[],
  snapshot: CodeSnapshot,
  session: ClientSession,
): Promise<void> {
  await WorkspaceSurfaceRevisionModel.create(
    [{ surfaceId, rev, actor, at: new Date(), changed, ...snapshot }],
    { session },
  );
}

async function inTransaction<T>(
  run: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(run);
  } finally {
    await session.endSession();
  }
}

export async function createSurface(
  input: SurfaceInput,
  caller: WorkspaceCaller,
): Promise<WorkspaceSurface> {
  const parsed = surfaceInputSchema.parse(input);
  const id = await inTransaction(async (session) => {
    const [doc] = await WorkspaceSurfaceModel.create(
      [{ ...parsed, rev: 1, createdBy: caller.actor }],
      { session },
    );
    if (!doc) throw new Error("Surface insert returned nothing");
    const created = doc._id.toString();
    await writeRevision(
      created,
      1,
      caller.actor,
      [...CODE_FIELDS],
      snapshotOf(parsed),
      session,
    );
    return created;
  });
  await unmountOthers(id, parsed.mount);
  return getSurface(id);
}

export async function updateSurface(
  id: string,
  patch: SurfacePatch,
  caller: WorkspaceCaller,
): Promise<WorkspaceSurface> {
  const current = await getSurface(id);
  const parsed = surfacePatchSchema.safeParse(patch);
  if (!parsed.success) {
    throw new WorkspaceError(400, "INVALID_INPUT", "Invalid surface", {
      issues: parsed.error.issues.slice(0, 5),
    });
  }
  const { mount, baseRev, ...code } = parsed.data;
  if (baseRev !== undefined && baseRev !== current.rev) {
    throw await conflict(id);
  }
  const next: CodeSnapshot = { ...snapshotOf(current), ...code };
  const changed = changedFields(current, next);
  if (changed.length === 0) {
    if (mount) {
      await WorkspaceSurfaceModel.updateOne(
        { _id: id },
        { $set: { mount } },
      ).exec();
      await unmountOthers(id, mount);
    }
    return getSurface(id);
  }
  const rev = current.rev + 1;
  const changedValues = Object.fromEntries(
    changed.map((field) => [field, next[field]]),
  );
  const applied = await inTransaction(async (session) => {
    const result = await WorkspaceSurfaceModel.updateOne(
      { _id: id, rev: current.rev },
      {
        $set: {
          ...changedValues,
          ...(mount ? { mount } : {}),
          rev,
          frameErrors: [],
        },
      },
      { session },
    ).exec();
    if (result.matchedCount === 0) return false;
    await writeRevision(id, rev, caller.actor, changed, next, session);
    return true;
  });
  if (!applied) throw await conflict(id);
  if (mount) await unmountOthers(id, mount);
  return getSurface(id);
}

async function conflict(id: string): Promise<WorkspaceError> {
  const surface = await getSurface(id);
  return new WorkspaceError(
    409,
    "CONFLICT",
    `Surface ${id} changed since it was read (now rev ${surface.rev})`,
    { surface },
  );
}

/** Bounded reads and compact writes for agents; never return source in conflicts. */
export async function surfaceSource(
  id: string,
  input: SurfaceSourceRequest,
  caller: WorkspaceCaller,
) {
  const current = await getSurface(id);
  if (input.action === "source_read") {
    return { id, rev: current.rev, ...readSurfaceSource(current, input) };
  }
  if (input.action === "source_search") {
    return { id, rev: current.rev, ...searchSurfaceSource(current, input) };
  }
  if (input.baseRev !== current.rev) {
    throw new WorkspaceError(
      409,
      "CONFLICT",
      "Surface changed; read the source again",
      { id, rev: current.rev },
    );
  }
  const patch: SurfacePatch = {};
  if (input.action === "source_edit") {
    Object.assign(patch, editSurfaceSource(current, input));
  } else {
    // Fetch everything before committing, so a failed import leaves every field intact.
    const entries = await Promise.all(
      input.sources.map(
        async (source) =>
          [
            source.field,
            await fetchSurfaceSource(
              source.sourceUrl,
              source.field === "head" ? SURFACE_HEAD_MAX : SURFACE_CODE_MAX,
            ),
          ] as const,
      ),
    );
    Object.assign(patch, Object.fromEntries(entries));
  }
  try {
    const updated = await updateSurface(
      id,
      { ...patch, baseRev: input.baseRev },
      caller,
    );
    return {
      id,
      rev: updated.rev,
      changed: SOURCE_FIELDS.filter(
        (field) => current[field] !== updated[field],
      ),
      ...(input.action === "source_edit"
        ? { editCount: input.edits.length }
        : { importedCount: input.sources.length }),
    };
  } catch (error) {
    if (error instanceof WorkspaceError && error.code === "CONFLICT") {
      const latest = await getSurface(id);
      throw new WorkspaceError(
        409,
        "CONFLICT",
        "Surface changed; read the source again",
        { id, rev: latest.rev },
      );
    }
    throw error;
  }
}

async function fetchSurfaceSource(
  sourceUrl: string,
  maxChars: number,
): Promise<string> {
  try {
    const { response, url } = await fetchGuarded(sourceUrl, {
      timeoutMs: ASSET_FETCH_TIMEOUT_MS,
    });
    try {
      const status = response.statusCode ?? 0;
      if (url.protocol !== "https:" || status < 200 || status >= 300) {
        throw new WorkspaceError(
          502,
          "SOURCE_FETCH_FAILED",
          `Source download failed (status ${status}); HTTPS is required`,
        );
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.byteLength;
        if (size > maxChars * 4)
          throw new WorkspaceError(
            413,
            "SOURCE_TOO_LARGE",
            "Source download exceeds the field limit",
          );
        chunks.push(bytes);
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks),
        );
      } catch {
        throw new WorkspaceError(
          422,
          "SOURCE_ENCODING",
          "Source must be valid UTF-8",
        );
      }
      if (text.length > maxChars)
        throw new WorkspaceError(
          413,
          "SOURCE_TOO_LARGE",
          `Source is limited to ${maxChars} characters`,
        );
      return text;
    } finally {
      response.destroy();
    }
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if (error instanceof UnfurlRefused)
      throw new WorkspaceError(422, "SOURCE_REFUSED", error.message);
    // Do not echo signed download URLs or credentials into tool responses.
    throw new WorkspaceError(
      502,
      "SOURCE_FETCH_FAILED",
      "Source download failed",
    );
  }
}

export async function deleteSurface(id: string): Promise<void> {
  await getSurface(id);
  await WorkspaceSurfaceModel.deleteOne({ _id: id }).exec();
  await WorkspaceSurfaceRevisionModel.deleteMany({ surfaceId: id }).exec();
}

export async function surfaceHistory(
  id: string,
  limit = 50,
): Promise<SurfaceRevision[]> {
  await getSurface(id);
  const rows = await WorkspaceSurfaceRevisionModel.find({ surfaceId: id })
    .sort({ rev: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .lean<IWorkspaceSurfaceRevision[]>()
    .exec();
  return rows.map((row) => ({
    rev: row.rev,
    actor: row.actor,
    at: row.at.toISOString(),
    name: row.name,
    changed: row.changed,
  }));
}

export async function revertSurface(
  id: string,
  rev: number,
  caller: WorkspaceCaller,
): Promise<WorkspaceSurface> {
  await getSurface(id);
  const target = await WorkspaceSurfaceRevisionModel.findOne({
    surfaceId: id,
    rev,
  })
    .lean<IWorkspaceSurfaceRevision>()
    .exec();
  if (!target) {
    throw new WorkspaceError(
      404,
      "NOT_FOUND",
      `Surface ${id} has no revision ${rev}`,
    );
  }
  return updateSurface(id, snapshotOf(target), caller);
}

export async function setSurfaceState(
  id: string,
  state: SurfaceState,
): Promise<SurfaceState> {
  await getSurface(id);
  const parsed = surfaceStateSchema.safeParse(state);
  if (!parsed.success) {
    throw new WorkspaceError(400, "INVALID_INPUT", "Invalid surface state", {
      issues: parsed.error.issues.slice(0, 5),
    });
  }
  await WorkspaceSurfaceModel.updateOne(
    { _id: id },
    { $set: { state: parsed.data } },
  ).exec();
  return parsed.data;
}

export async function appendSurfaceErrors(
  id: string,
  errors: Omit<SurfaceError, "at">[],
  rev?: number,
): Promise<SurfaceError[]> {
  await getSurface(id);
  const at = new Date().toISOString();
  await WorkspaceSurfaceModel.updateOne(
    { _id: id, ...(rev === undefined ? {} : { rev }) },
    {
      $push: {
        frameErrors: {
          $each: errors.map((error) => ({ ...error, at })),
          $slice: -SURFACE_ERRORS_MAX,
        },
      },
    },
  ).exec();
  return (await getSurface(id)).errors;
}

export async function clearSurfaceErrors(id: string): Promise<void> {
  await getSurface(id);
  await WorkspaceSurfaceModel.updateOne(
    { _id: id },
    { $set: { frameErrors: [] } },
  ).exec();
}

async function readCapped(
  response: NodeJS.ReadableStream,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) {
      throw new WorkspaceError(
        413,
        "ASSET_TOO_LARGE",
        `Assets are limited to ${limit} bytes`,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function fetchAsset(
  sourceUrl: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  try {
    const { response } = await fetchGuarded(sourceUrl, {
      timeoutMs: ASSET_FETCH_TIMEOUT_MS,
    });
    const status = response.statusCode ?? 0;
    if (status >= 400) {
      response.destroy();
      throw new WorkspaceError(
        502,
        "ASSET_FETCH_FAILED",
        `${sourceUrl} answered ${status}`,
      );
    }
    try {
      const bytes = await readCapped(response, SURFACE_ASSET_MAX_BYTES);
      const header = response.headers["content-type"]?.split(";")[0]?.trim();
      return { bytes, contentType: header || "application/octet-stream" };
    } finally {
      response.destroy();
    }
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if (error instanceof UnfurlRefused) {
      throw new WorkspaceError(422, "ASSET_REFUSED", error.message);
    }
    throw new WorkspaceError(
      502,
      "ASSET_FETCH_FAILED",
      error instanceof Error ? error.message : "Asset fetch failed",
    );
  }
}

export async function addSurfaceAsset(
  id: string,
  input: SurfaceAssetAdd,
): Promise<{ asset: SurfaceAsset; surface: WorkspaceSurface }> {
  await getSurface(id);
  let bytes: Buffer;
  let contentType: string;
  if ("dataBase64" in input) {
    bytes = Buffer.from(input.dataBase64, "base64");
    contentType = input.contentType;
    if (bytes.byteLength > SURFACE_ASSET_MAX_BYTES) {
      throw new WorkspaceError(
        413,
        "ASSET_TOO_LARGE",
        `Assets are limited to ${SURFACE_ASSET_MAX_BYTES} bytes`,
      );
    }
  } else {
    const fetched = await fetchAsset(input.sourceUrl);
    bytes = fetched.bytes;
    contentType = input.contentType ?? fetched.contentType;
  }
  if (bytes.byteLength === 0) {
    throw new WorkspaceError(400, "INVALID_INPUT", "The asset is empty");
  }
  const stored = await uploadFileToStorage(
    new File([new Uint8Array(bytes)], input.name, { type: contentType }),
    "image",
  );
  const asset: SurfaceAsset = {
    name: input.name,
    url: stored.publicUrl,
    contentType,
    size: bytes.byteLength,
  };
  const others = {
    $filter: {
      input: { $ifNull: ["$assets", []] },
      cond: { $ne: ["$$this.name", input.name] },
    },
  };
  const result = await WorkspaceSurfaceModel.updateOne(
    { _id: id, $expr: { $lt: [{ $size: others }, SURFACE_ASSETS_MAX] } },
    [{ $set: { assets: { $concatArrays: [others, [asset]] } } }],
    { updatePipeline: true },
  ).exec();
  if (result.matchedCount === 0) {
    await getSurface(id);
    throw new WorkspaceError(
      409,
      "TOO_MANY_ASSETS",
      `A surface holds at most ${SURFACE_ASSETS_MAX} assets`,
    );
  }
  return { asset, surface: await getSurface(id) };
}

export async function removeSurfaceAsset(
  id: string,
  name: string,
): Promise<WorkspaceSurface> {
  await getSurface(id);
  const result = await WorkspaceSurfaceModel.updateOne(
    { _id: id, "assets.name": name },
    { $pull: { assets: { name } } },
  ).exec();
  if (result.matchedCount === 0) {
    throw new WorkspaceError(404, "NOT_FOUND", `No asset named ${name}`);
  }
  return getSurface(id);
}

export type RawToolResult = Awaited<ReturnType<MCPClient["callTool"]>>;

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/** structuredContent when present, else the text parsed as JSON, else the text. */
export function shapeCallResult(raw: RawToolResult): SurfaceCallResult {
  const isError = "isError" in raw && raw.isError === true;
  if (
    "structuredContent" in raw &&
    raw.structuredContent !== undefined &&
    raw.structuredContent !== null
  ) {
    return { isError, result: raw.structuredContent };
  }
  const text = textOf("content" in raw ? raw.content : undefined);
  try {
    return { isError, result: JSON.parse(text) };
  } catch {
    return { isError, result: text };
  }
}

export async function callSurfaceTool(
  id: string,
  call: SurfaceCall,
): Promise<SurfaceCallResult> {
  await getSurface(id);
  // Loaded on use: the connector service is server-only and pulls in the AI
  // SDK, which the rest of this module (and its tests) has no need for.
  const { ensurePrimaryConnector, openConnectorClient } = await import(
    "@/lib/connectors/service"
  );
  const connector = await ensurePrimaryConnector().catch(() => null);
  if (!connector?.enabled || connector.status !== "ready") {
    throw new WorkspaceError(
      503,
      "CONNECTOR_UNAVAILABLE",
      "The denizlg24 connector is not available",
    );
  }
  const client = await openConnectorClient(connector, {
    actor: `surface:${id}`,
  }).catch((error) => {
    throw new WorkspaceError(
      502,
      "CONNECTOR_FAILED",
      error instanceof Error ? error.message : "Connector failed",
    );
  });
  try {
    const result = await client.callTool({
      name: call.tool,
      arguments: call.args,
    });
    return shapeCallResult(result);
  } catch (error) {
    throw new WorkspaceError(
      502,
      "CONNECTOR_FAILED",
      error instanceof Error ? error.message : "Tool call failed",
    );
  } finally {
    await client.close().catch(() => undefined);
  }
}
