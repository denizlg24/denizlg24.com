import {
  type AuthVariables,
  requireRole,
  requireScope,
} from "@repo/cloud-core";
import {
  type StoragePrincipal,
  type StorageService,
  StorageServiceError,
  TUS_VERSION,
} from "@repo/cloud-core/storage";
import type { Context } from "hono";
import { Hono } from "hono";

type StorageContext = Context<{ Variables: AuthVariables }>;

function principal(context: StorageContext): StoragePrincipal {
  const project = context.get("project");
  const scopes = context.get("scopes");
  return {
    user: context.get("user"),
    ...(project ? { project } : {}),
    ...(scopes ? { scopes } : {}),
  };
}

function serviceError(context: StorageContext, error: unknown): Response {
  if (error instanceof StorageServiceError) {
    return context.json(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  }
  throw error;
}

async function jsonBody(context: StorageContext): Promise<unknown> {
  return context.req.json().catch(() => null);
}

export function storageRoutes(service: StorageService) {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.get("/folders/roots", requireScope("storage:read"));
  router.post("/folders", requireScope("storage:write"));
  router.get("/folders/:id", requireScope("storage:read"));
  router.get("/folders/:id/contents", requireScope("storage:read"));
  router.patch("/folders/:id", requireScope("storage:write"));
  router.delete("/folders/:id", requireScope("storage:delete"));
  router.get("/files", requireScope("storage:read"));
  router.get("/files/:id", requireScope("storage:read"));
  router.get("/files/:id/download", requireScope("storage:read"));
  router.patch("/files/:id", requireScope("storage:write"));
  router.delete("/files/:id", requireScope("storage:delete"));
  router.post("/files/:id/share", requireScope("storage:read"));
  router.post("/download-archive", requireScope("storage:read"));
  router.post("/uploads", requireScope("storage:write"));
  // Hono dispatches HEAD through a matching GET route.
  router.get("/uploads/:id", requireScope("storage:write"));
  router.patch("/uploads/:id", requireScope("storage:write"));
  router.delete("/uploads/:id", requireScope("storage:write"));

  router.get("/folders/roots", async (context) => {
    try {
      return context.json({ data: await service.roots(principal(context)) });
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.post("/folders", async (context) => {
    try {
      const folder = await service.createFolder(
        principal(context),
        await jsonBody(context),
      );
      return context.json(
        {
          data: {
            id: folder.id,
            path: folder.path,
            name: folder.name,
            parentId: folder.parentId,
            createdAt: folder.createdAt,
          },
        },
        201,
      );
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.get("/folders/:id", async (context) => {
    try {
      const folder = await service.getFolder(
        principal(context),
        context.req.param("id"),
      );
      return context.json({ data: folder });
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.get("/folders/:id/contents", async (context) => {
    try {
      const result = await service.folderContents(
        principal(context),
        context.req.param("id"),
        new URL(context.req.url).searchParams,
      );
      return context.json(result);
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.patch("/folders/:id", async (context) => {
    try {
      const folder = await service.updateFolder(
        principal(context),
        context.req.param("id"),
        await jsonBody(context),
      );
      return context.json({
        data: {
          id: folder.id,
          path: folder.path,
          name: folder.name,
          parentId: folder.parentId,
        },
      });
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.delete("/folders/:id", async (context) => {
    const id = context.req.param("id");
    try {
      await service.deleteFolder(principal(context), id);
      return context.json({ data: { id } });
    } catch (error) {
      return serviceError(context, error);
    }
  });

  router.get("/files", async (context) => {
    try {
      const url = new URL(context.req.url);
      return context.json(
        await service.listFiles(
          principal(context),
          url.searchParams.get("folderId"),
          url.searchParams,
        ),
      );
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.get("/files/:id", async (context) => {
    try {
      const file = await service.getFile(
        principal(context),
        context.req.param("id"),
      );
      return context.json({
        data: {
          id: file.id,
          filename: file.filename,
          path: file.path,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          checksum: file.checksum,
          tier: file.tier,
          lastAccessedAt: file.lastAccessedAt,
          accessCount: file.accessCount,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
        },
      });
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.get("/files/:id/download", async (context) => {
    try {
      return await service.download(
        principal(context),
        context.req.param("id"),
        context.req.raw,
      );
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.patch("/files/:id", async (context) => {
    try {
      return context.json({
        data: await service.updateFile(
          principal(context),
          context.req.param("id"),
          await jsonBody(context),
        ),
      });
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.delete("/files/:id", async (context) => {
    const id = context.req.param("id");
    try {
      await service.deleteFile(principal(context), id);
      return context.json({ data: { id } });
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.post("/files/:id/share", async (context) => {
    try {
      const token = await service.createShare(
        principal(context),
        context.req.param("id"),
        await jsonBody(context),
      );
      return context.json({ data: { token } });
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.get("/share/:token", async (context) => {
    try {
      return await service.sharedDownload(
        context.req.param("token"),
        context.req.raw,
      );
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.post("/download-archive", async (context) => {
    try {
      return await service.archive(principal(context), await jsonBody(context));
    } catch (error) {
      return serviceError(context, error);
    }
  });

  router.use("/uploads", async (context, next) => {
    await next();
    context.header("Tus-Resumable", TUS_VERSION);
  });
  router.use("/uploads/*", async (context, next) => {
    await next();
    context.header("Tus-Resumable", TUS_VERSION);
  });
  router.options("/uploads", (context) => {
    context.header("Tus-Version", TUS_VERSION);
    context.header("Tus-Extension", "creation,termination");
    return context.body(null, 204);
  });
  router.post("/uploads", async (context) => {
    try {
      const upload = await service.createUpload(
        principal(context),
        context.req.raw,
      );
      context.header("Location", `/api/storage/uploads/${upload.id}`);
      context.header("Upload-Offset", String(upload.offset));
      return context.body(null, 201);
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.get("/uploads/:id", async (context) => {
    if (context.req.method !== "HEAD") {
      return context.body(null, 405, { Allow: "HEAD" });
    }
    try {
      const upload = await service.uploadStatus(
        principal(context),
        context.req.param("id"),
      );
      context.header("Upload-Offset", String(upload.offset));
      context.header("Upload-Length", String(upload.length));
      context.header("Cache-Control", "no-store");
      return context.body(null, 200);
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.patch("/uploads/:id", async (context) => {
    try {
      const offset = await service.uploadChunk(
        principal(context),
        context.req.param("id"),
        context.req.raw,
      );
      context.header("Upload-Offset", String(offset));
      return context.body(null, 204);
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.delete("/uploads/:id", async (context) => {
    try {
      await service.cancelUpload(principal(context), context.req.param("id"));
      return context.body(null, 204);
    } catch (error) {
      return serviceError(context, error);
    }
  });

  return router;
}

export function storageSearchRoutes(service: StorageService) {
  const router = new Hono<{ Variables: AuthVariables }>();
  router.get("/", requireScope("storage:read"));
  router.post("/reindex", requireRole("superuser"));
  router.get("/", async (context) => {
    try {
      return context.json(
        await service.search(
          principal(context),
          new URL(context.req.url).searchParams,
        ),
      );
    } catch (error) {
      return serviceError(context, error);
    }
  });
  router.post("/reindex", async (context) => {
    try {
      return context.json({
        data: { indexed: await service.reindex(principal(context)) },
      });
    } catch (error) {
      return serviceError(context, error);
    }
  });
  return router;
}
