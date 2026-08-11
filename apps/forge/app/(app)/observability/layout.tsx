"use client";

import { cn } from "@repo/ui/utils";
import { Boxes, Layers, Server } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Three pages of the same subject, kept reachable from each other now that none
 * of them is a top-level nav entry any more. Step 7 folds them into one page and
 * this rail goes with them.
 */
const SECTIONS = [
  { href: "/observability", label: "host", icon: Server },
  { href: "/observability/containers", label: "containers", icon: Boxes },
  { href: "/observability/images", label: "images", icon: Layers },
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
                "flex items-center gap-1.5 whitespace-nowrap text-xs transition-colors",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <section.icon className="size-3.5 shrink-0" aria-hidden />
              {section.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
