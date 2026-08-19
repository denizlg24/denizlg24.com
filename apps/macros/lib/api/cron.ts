import { createHash, timingSafeEqual } from "node:crypto";

function timingSafeEqualText(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();

  return timingSafeEqual(leftHash, rightHash);
}

export function isAuthorizedCronRequest(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  const secret = process.env.MACROS_CRON_SECRET;

  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  return timingSafeEqualText(authorization.slice("Bearer ".length), secret);
}
