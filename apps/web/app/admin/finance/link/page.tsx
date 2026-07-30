import { redirect } from "next/navigation";
import { completeFinanceLink } from "@/lib/finance/connection";
import { getAdminSession } from "@/lib/require-admin";

/**
 * Consumes the single-use Enable Banking callback.
 *
 * The provider's whitelisted redirect target is the route handler at
 * `/api/admin/finance/callback`, which only forwards here — a route handler is
 * an HTTP endpoint, not a navigation target, so it cannot be the destination
 * `LoginForm` pushes to when the handshake has to resume after logging in.
 *
 * Deliberately outside `/admin/dashboard`: that layout answers a missing
 * session with `forbidden()`, which would strand a desktop-initiated link on a
 * 403 while its `FinanceLinkState` quietly expired.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; state?: string }>;
}) {
  const { code, state } = await searchParams;

  if (!(await getAdminSession())) {
    const resume = new URLSearchParams();
    if (code) resume.set("code", code);
    if (state) resume.set("state", state);
    const destination = `/admin/finance/link?${resume.toString()}`;
    redirect(`/auth/login?callbackUrl=${encodeURIComponent(destination)}`);
  }

  if (!code || !state) {
    redirect("/admin/dashboard/finance?link=invalid");
  }

  // `redirect` throws, so completion has to settle on a status first rather
  // than redirecting from inside the try.
  let status = "connected";
  try {
    await completeFinanceLink(code, state);
  } catch (error) {
    console.error("[finance] Link completion failed", error);
    status = "failed";
  }
  redirect(`/admin/dashboard/finance?link=${status}`);
}
