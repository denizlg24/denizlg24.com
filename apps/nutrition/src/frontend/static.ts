import { extname, join, normalize, relative, resolve } from "node:path";

import { fail } from "../shared/http";

const distRoot = resolve(process.cwd(), "frontend/dist");
const indexPath = join(distRoot, "index.html");

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const isApiPath = (pathname: string) =>
  pathname === "/api" ||
  pathname.startsWith("/api/") ||
  pathname === "/items" ||
  pathname.startsWith("/items/") ||
  pathname === "/sources" ||
  pathname.startsWith("/sources/") ||
  pathname === "/docs" ||
  pathname.startsWith("/docs/") ||
  pathname === "/health" ||
  pathname === "/ready";

const getContentType = (filePath: string) =>
  contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";

const resolveStaticPath = (pathname: string) => {
  const decodedPath = decodeURIComponent(pathname).replace(/^[/\\]+/, "");
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const candidatePath = join(distRoot, normalizedPath);
  const relativePath = relative(distRoot, candidatePath);

  if (relativePath.startsWith("..") || resolve(candidatePath) === distRoot) {
    return indexPath;
  }

  return candidatePath;
};

const serveFile = async (filePath: string) => {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return undefined;
  }

  return new Response(file, {
    headers: {
      "cache-control":
        filePath === indexPath
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      "content-type": getContentType(filePath),
    },
  });
};

export const serveFrontend = async (request: Request) => {
  const { pathname } = new URL(request.url);

  if (isApiPath(pathname)) {
    return new Response(
      JSON.stringify(
        fail({ code: "NOT_FOUND", message: "Route not found" }, "unknown"),
      ),
      {
        status: 404,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }

  const staticResponse = await serveFile(resolveStaticPath(pathname));

  if (staticResponse) {
    return staticResponse;
  }

  return serveFile(indexPath);
};
