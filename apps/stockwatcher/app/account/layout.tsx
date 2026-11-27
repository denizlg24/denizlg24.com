import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeSync } from "@/components/admin/theme-sync";
import { BrandGlyph } from "@/components/brand-glyph";
import { currentUser } from "@/lib/auth";
import { readWorkspace } from "@/lib/db";

export const metadata: Metadata = {
  title: "Account · Stockwatcher",
  robots: { index: false, follow: false },
};

export default async function AccountLayout({
  children,
}: LayoutProps<"/account">) {
  const user = await currentUser();
  if (!user) redirect("/");
  const { data } = await readWorkspace(user.id);
  return (
    <div className="admin">
      <ThemeSync theme={data.settings.theme} />
      <header className="admin-masthead">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden>
            <BrandGlyph size={15} />
          </span>
          <span className="brand-name">Stockwatcher</span>
        </Link>
        <nav aria-label="Account">
          <Link href="/">Back to the desk</Link>
        </nav>
        <span className="admin-masthead-meta">
          {user.name}
          {user.email ? ` · ${user.email}` : ""}
        </span>
      </header>
      <main className="admin-page">{children}</main>
    </div>
  );
}
