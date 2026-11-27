import type { Metadata } from "next";
import Link from "next/link";
import { ThemeSync } from "@/components/admin/theme-sync";
import { BrandGlyph } from "@/components/brand-glyph";
import { requireAdmin } from "@/lib/admin";
import { readWorkspace } from "@/lib/db";

export const metadata: Metadata = {
  title: "Assistant audit · Stockwatcher",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  const { data } = await readWorkspace(admin.id);
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
        <nav aria-label="Admin">
          <Link href="/admin">Assistant audit</Link>
          <Link href="/admin/enquiries">Enquiries</Link>
        </nav>
        <span className="admin-masthead-meta">
          Signed in as {admin.name} · times in UTC
        </span>
      </header>
      <main className="admin-page">{children}</main>
    </div>
  );
}
