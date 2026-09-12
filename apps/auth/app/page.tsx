"use client";

import Link from "next/link";
import { Shell } from "@/components/shell";

const APPS = [
  { name: "forge", href: "https://forge.denizlg24.com" },
  { name: "cloud", href: "https://cloud.denizlg24.com" },
  { name: "storage", href: "https://storage.denizlg24.com" },
  { name: "status", href: "https://status.denizlg24.com/admin" },
  { name: "admin", href: "https://denizlg24.com/admin/dashboard" },
] as const;

export default function HomePage() {
  return (
    <Shell>
      <div className="flex flex-col text-sm">
        {APPS.map((app) => (
          <a
            key={app.name}
            href={app.href}
            className="grid grid-cols-[6rem_1fr] border-b py-2 hover:bg-accent/40"
          >
            <span>{app.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {new URL(app.href).host}
            </span>
          </a>
        ))}
        <Link
          href="/clients"
          className="grid grid-cols-[6rem_1fr] border-b py-2 hover:bg-accent/40"
        >
          <span>clients</span>
          <span className="font-mono text-xs text-muted-foreground">oauth</span>
        </Link>
      </div>
    </Shell>
  );
}
