import { currentUser, json, sameOrigin } from "@/lib/auth";
import { maxPictureBytes, sniffPicture } from "@/lib/picture-format";
import {
  deletePicture,
  readPicture,
  writePicture,
} from "@/lib/profile-picture";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  const picture = user.demo ? null : await readPicture(user.id);
  if (!picture) return json({ error: "No picture." }, 404);
  const etag = `"${picture.version}"`;
  // The URL carries the version, so a cached copy is never stale.
  const cache = new URL(request.url).searchParams.has("v")
    ? "private, max-age=31536000, immutable"
    : "private, no-cache";
  const headers = {
    "Cache-Control": cache,
    ETag: etag,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  return new Response(Buffer.from(picture.image), {
    headers: {
      ...headers,
      "Content-Type": picture.mime,
      "Content-Length": String(picture.image.byteLength),
    },
  });
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (user.demo)
    return json({ error: "Pictures are off in preview sessions." }, 403);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxPictureBytes)
    return json({ error: "That picture is too large." }, 413);
  const image = new Uint8Array(await request.arrayBuffer());
  if (image.byteLength === 0 || image.byteLength > maxPictureBytes)
    return json({ error: "That picture is too large." }, 413);
  const mime = sniffPicture(image);
  if (!mime) return json({ error: "Use a JPEG, PNG or WebP picture." }, 415);
  const version = await writePicture(user.id, mime, image);
  return json({ url: `/api/account/picture?v=${version}` });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (user.demo)
    return json({ error: "Pictures are off in preview sessions." }, 403);
  await deletePicture(user.id);
  return json({ url: null });
}
