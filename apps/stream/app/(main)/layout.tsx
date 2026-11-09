import { TopNav } from "@/components/nav/top-nav";
import { auth } from "@/lib/auth";
import { currentViewer } from "@/lib/current-viewer";
import { serializeProfile } from "@/lib/members";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await currentViewer();
  return (
    <>
      {viewer ? (
        <TopNav
          audience={viewer.audience.map(serializeProfile)}
          profiles={viewer.profiles}
          logoutUrl={auth.logoutUrl("/sign-in")}
        />
      ) : null}
      <main className="min-h-dvh">{children}</main>
    </>
  );
}
