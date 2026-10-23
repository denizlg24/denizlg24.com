import type { Me } from "@repo/schemas/stream";
import { ApiError } from "./errors";

export type MemberStatus =
  | "loading"
  | "not-a-member"
  | "needs-setup"
  | "unavailable"
  | "ready";

/**
 * What `GET /me` says about this account. 403 `not_a_member` and 409
 * `needs_setup` are answers; anything else that fails (503
 * `auth_unavailable`, offline) is "try again", never a sign-out.
 */
export function memberStatus(
  data: Me | undefined,
  error: Error | null,
): MemberStatus {
  if (error instanceof ApiError) {
    if (error.code === "not_a_member") return "not-a-member";
    if (error.code === "needs_setup") return "needs-setup";
  }
  if (data) return "ready";
  return error ? "unavailable" : "loading";
}
