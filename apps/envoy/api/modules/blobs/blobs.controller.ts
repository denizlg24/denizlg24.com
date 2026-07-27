import type { Context } from "hono";
import { z } from "zod";
import {
  BlobAccessDeniedError,
  getUploadSignedUrl,
  getDownloadSignedUrl,
  replaceBlobAccess,
} from "./blobs.service";

const blobAccessSchema = z.object({
  memberIds: z.array(z.string().uuid()).max(500).nullable(),
});
const blobParamsSchema = z.object({
  projectId: z.string().uuid(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});

function parseBlobParams(c: Context) {
  return blobParamsSchema.safeParse(c.req.param());
}

export async function uploadBlob(c: Context) {
  const user = c.get("user");
  const params = parseBlobParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid projectId or blob hash" }, 400);
  }
  const { projectId, hash } = params.data;

  const type =
    c.req.query("type") === "manifest"
      ? "manifest"
      : c.req.query("type") === "commit"
      ? "commit"
      : "blob";

  const result = await getUploadSignedUrl(user.id, projectId, hash, type);

  return c.json(result);
}

export async function downloadBlob(c: Context) {
  const user = c.get("user");
  const params = parseBlobParams(c);
  if (!params.success) {
    return c.json({ error: "Invalid projectId or blob hash" }, 400);
  }
  const { projectId, hash } = params.data;

  const type =
    c.req.query("type") === "manifest"
      ? "manifest"
      : c.req.query("type") === "commit"
      ? "commit"
      : "blob";

  try {
    const result = await getDownloadSignedUrl(user.id, projectId, hash, type);

    return c.json(result);
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
  const parsed = blobAccessSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "memberIds must be null or contain valid user IDs" },
      400
    );
  }

  try {
    const policy = await replaceBlobAccess({
      requestingUserId: user.id,
      projectId,
      blobHash: hash,
      memberIds: parsed.data.memberIds,
    });
    return c.json(policy);
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
