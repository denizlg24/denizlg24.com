"use client";

import { cn } from "@repo/ui/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Three pages of the same subject, kept reachable from each other now that none
 * of them is a top-level nav entry any more. Step 7 folds them into one page and
 * this rail goes with them.
 */
const SECTIONS = [
  { href: "/observability", label: "host" },
  { href: "/observability/containers", label: "containers" },
  { href: "/observability/images", label: "images" },
] as const;

export default function ObservabilityLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-4 overflow-x-auto border-b pb-2">
        {SECTIONS.map((section) => {
          const active =
            section.href === "/observability"
              ? pathname === section.href
              : pathname.startsWith(section.href);
          return (
            <Link
              key={section.href}
              href={section.href}
              className={cn(
                "whitespace-nowrap text-xs transition-colors",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
