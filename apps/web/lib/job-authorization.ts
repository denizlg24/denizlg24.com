import { timingSafeEqual } from "node:crypto";

function matchesBearer(provided: string | null, token: string | undefined) {
  if (!provided || !token?.trim()) return false;
  const expected = Buffer.from(`Bearer ${token.trim()}`);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isAuthorizedJobRequest(request: Request) {
  const provided = request.headers.get("Authorization");
  return (
    matchesBearer(provided, process.env.AGENT_MEMORY_JOB_BEARER_TOKEN) ||
    matchesBearer(provided, process.env.CRON_SECRET)
  );
}
