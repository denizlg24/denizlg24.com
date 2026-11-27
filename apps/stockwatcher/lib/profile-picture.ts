import "server-only";
import { store } from "./db";
import { isPictureMime, type PictureMime } from "./picture-format";

/**
 * Profile pictures live here, not on the deniz auth identity: the auth API has
 * no upload path, and its `image` field is a URL that would ride along in
 * every session read and ID token. The browser crops and shrinks the photo to
 * a small square before it is sent, so a row is a few kilobytes.
 */
export type Picture = { mime: PictureMime; image: Uint8Array; version: number };

export async function pictureVersion(userId: string): Promise<number | null> {
  const s = await store();
  if (s.kind === "pg") {
    const [row] = await s.sql<{ updated_at: Date }[]>`
      SELECT updated_at FROM stockwatcher_profile_pictures
      WHERE user_id = ${userId}`;
    return row ? row.updated_at.getTime() : null;
  }
  const row = s.db
    .prepare("SELECT updated_at FROM profile_pictures WHERE user_id = ?")
    .get(userId);
  return row ? Number(row.updated_at) : null;
}

/** Where the topbar and the account page load the picture from, cache-busted per upload. */
export async function pictureUrl(userId: string): Promise<string | null> {
  const version = await pictureVersion(userId).catch(() => null);
  return version === null ? null : `/api/account/picture?v=${version}`;
}

export async function readPicture(userId: string): Promise<Picture | null> {
  const s = await store();
  if (s.kind === "pg") {
    const [row] = await s.sql<
      { mime: string; image: Uint8Array; updated_at: Date }[]
    >`
      SELECT mime, image, updated_at FROM stockwatcher_profile_pictures
      WHERE user_id = ${userId}`;
    if (!row || !isPictureMime(row.mime)) return null;
    return {
      mime: row.mime,
      image: row.image,
      version: row.updated_at.getTime(),
    };
  }
  const row = s.db
    .prepare(
      "SELECT mime, image, updated_at FROM profile_pictures WHERE user_id = ?",
    )
    .get(userId);
  if (!row || typeof row.mime !== "string" || !isPictureMime(row.mime))
    return null;
  if (!(row.image instanceof Uint8Array)) return null;
  return { mime: row.mime, image: row.image, version: Number(row.updated_at) };
}

export async function writePicture(
  userId: string,
  mime: PictureMime,
  image: Uint8Array,
): Promise<number> {
  const now = new Date();
  const s = await store();
  if (s.kind === "pg") {
    await s.sql`
      INSERT INTO stockwatcher_profile_pictures (user_id, mime, image, updated_at)
      VALUES (${userId}, ${mime}, ${Buffer.from(image)}, ${now})
      ON CONFLICT (user_id) DO UPDATE SET mime = EXCLUDED.mime,
        image = EXCLUDED.image, updated_at = EXCLUDED.updated_at`;
  } else {
    s.db
      .prepare(
        "INSERT INTO profile_pictures (user_id, mime, image, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET mime = excluded.mime, image = excluded.image, updated_at = excluded.updated_at",
      )
      .run(userId, mime, image, now.getTime());
  }
  return now.getTime();
}

export async function deletePicture(userId: string): Promise<void> {
  const s = await store();
  if (s.kind === "pg") {
    await s.sql`DELETE FROM stockwatcher_profile_pictures WHERE user_id = ${userId}`;
  } else {
    s.db.prepare("DELETE FROM profile_pictures WHERE user_id = ?").run(userId);
  }
}
