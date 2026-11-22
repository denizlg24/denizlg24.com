import "server-only";

import { createHmac, randomBytes, randomInt } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { screenShares } from "@/db/schema";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_MS = 5 * 60_000;
const HANDSHAKE_MS = 2 * 60_000;
const newKey = () => randomBytes(32).toString("base64url");
const active = () => gt(screenShares.expiresAt, new Date());

export async function createScreenShare() {
  await db.delete(screenShares).where(lt(screenShares.expiresAt, new Date()));
  const receiverKey = newKey();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = Array.from({ length: 8 }, () =>
      ALPHABET.charAt(randomInt(ALPHABET.length)),
    ).join("");
    const [share] = await db
      .insert(screenShares)
      .values({
        code,
        receiverKey,
        expiresAt: new Date(Date.now() + PAIRING_MS),
      })
      .onConflictDoNothing()
      .returning({ receiverKey: screenShares.receiverKey });
    if (share) return share;
  }
  throw new Error("Could not allocate a screen share code");
}

export async function pairScreenShare(code: string) {
  const senderKey = newKey();
  const [share] = await db
    .update(screenShares)
    .set({
      senderKey,
      expiresAt: new Date(Date.now() + HANDSHAKE_MS),
    })
    .where(
      and(
        eq(screenShares.code, code),
        isNull(screenShares.senderKey),
        active(),
      ),
    )
    .returning({ senderKey: screenShares.senderKey });
  return share?.senderKey ?? null;
}

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const urls = process.env.STREAM_TURN_URLS?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const secret = process.env.STREAM_TURN_SECRET;
  if (urls?.length && secret) {
    const username = `${Math.floor(Date.now() / 1000) + 24 * 60 * 60}:${randomBytes(8).toString("hex")}`;
    const credential = createHmac("sha1", secret)
      .update(username)
      .digest("base64");
    servers.push({ urls, username, credential });
  }
  return servers;
}

export async function readScreenShare(key: string) {
  const [share] = await db
    .select()
    .from(screenShares)
    .where(
      and(
        or(eq(screenShares.receiverKey, key), eq(screenShares.senderKey, key)),
        active(),
      ),
    );
  if (!share) return null;
  return share.receiverKey === key
    ? { code: share.code, offer: share.offer }
    : { answer: share.answer };
}

export function screenShareIce() {
  return { iceServers: iceServers() };
}

export async function publishScreenSignal(
  key: string,
  type: "offer" | "answer",
  sdp: string,
) {
  const where =
    type === "offer"
      ? and(eq(screenShares.senderKey, key), isNull(screenShares.offer))
      : and(
          eq(screenShares.receiverKey, key),
          isNotNull(screenShares.offer),
          isNull(screenShares.answer),
        );
  const [updated] = await db
    .update(screenShares)
    .set({ [type]: sdp })
    .where(and(where, active()))
    .returning({ code: screenShares.code });
  return !!updated;
}

export async function closeScreenShare(key: string) {
  await db
    .delete(screenShares)
    .where(
      or(eq(screenShares.receiverKey, key), eq(screenShares.senderKey, key)),
    );
}
