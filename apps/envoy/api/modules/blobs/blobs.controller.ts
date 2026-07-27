import {
  envoyBlobAccessInputSchema,
  envoyBlobAccessResponseSchema,
  envoyBlobParamsSchema,
  envoyBlobTypeSchema,
  envoySignedUrlResponseSchema,
} from "@repo/schemas/envoy";
import type { Context } from "hono";
import {
  BlobAccessDeniedError,
  getDownloadSignedUrl,
  getUploadSignedUrl,
  replaceBlobAccess,
} from "./blobs.service";

function parseBlobParams(c: Context) {
  return envoyBlobParamsSchema.safeParse(c.req.param());
}

function parseBlobType(c: Context) {
  return envoyBlobTypeSchema.catch("blob").parse(c.req.query("type"));
}

export async function uploadBlob(c: Context) {
  const user = c.get("user");
  const params = parseBlobParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid projectId or blob hash" }, 400);
  }
  const { projectId, hash } = params.data;

  const type = parseBlobType(c);

  const result = await getUploadSignedUrl(user.id, projectId, hash, type);

  return c.json(envoySignedUrlResponseSchema.parse(result));
}

export async function downloadBlob(c: Context) {
  const user = c.get("user");
  const params = parseBlobParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid projectId or blob hash" }, 400);
  }
  const { projectId, hash } = params.data;

  const type = parseBlobType(c);

  try {
    const result = await getDownloadSignedUrl(user.id, projectId, hash, type);

    return c.json(envoySignedUrlResponseSchema.parse(result));
  } catch (error) {
    if (error instanceof BlobAccessDeniedError) {
      return c.json({ error: "Not authorized to download this blob" }, 403);
    }
    throw error;
  }
}

export async function setBlobAccess(c: Context) {
  const user = c.get("user");
  const params = parseBlobParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid projectId or blob hash" }, 400);
  }
  const { projectId, hash } = params.data;

  const body = await c.req.json().catch(() => null);
  const parsed = envoyBlobAccessInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "memberIds must be null or contain valid user IDs" },
      400,
    );
  }

  try {
    const policy = await replaceBlobAccess({
      requestingUserId: user.id,
      projectId,
      blobHash: hash,
      memberIds: parsed.data.memberIds,
    });
    return c.json(envoyBlobAccessResponseSchema.parse(policy));
  } catch (error) {
    if (error instanceof BlobAccessDeniedError) {
      return c.json({ error: error.message }, 403);
    }
    if (error instanceof TypeError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
}
