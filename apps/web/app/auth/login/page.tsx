import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/get-server-session";
import { LoginForm } from "./login-form";

const DEFAULT_DESTINATION = "/admin/dashboard";

/**
 * Reduces a `callbackUrl` to a same-origin path. Anything absolute, protocol
 * relative, or pointing elsewhere is discarded — otherwise the parameter is an
 * open redirect.
 */
function safeDestination(callbackUrl: string | undefined) {
  if (!callbackUrl) return DEFAULT_DESTINATION;
  try {
    const parsed = new URL(callbackUrl, "http://internal.invalid");
    if (parsed.origin !== "http://internal.invalid") {
      // Absolute URL: only keep it when it targets the configured site origin.
      const site = process.env.NEXT_PUBLIC_SITE_URL;
      if (!site || new URL(site).origin !== parsed.origin) {
        return DEFAULT_DESTINATION;
      }
    }
    const destination = `${parsed.pathname}${parsed.search}`;
    return destination.startsWith("/") && !destination.startsWith("//")
      ? destination
      : DEFAULT_DESTINATION;
  } catch {
    return DEFAULT_DESTINATION;
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const destination = safeDestination(callbackUrl);
  const session = await getServerSession();
  if (session) {
    redirect(destination);
  }

  return (
    <main className="w-full flex flex-col items-center">
      <section className="w-full mx-auto max-w-5xl">
        <h1 className="sm:text-5xl text-4xl font-calistoga font-bold text-center">
          login.
        </h1>
        <LoginForm destination={destination} />
      </section>
    </main>
  );
}
