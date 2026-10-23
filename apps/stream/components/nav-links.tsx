"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({
  items,
  classic,
}: {
  items: { href: string; label: string }[];
  classic: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-1 md:gap-2">
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            data-nav
            aria-current={active ? "page" : undefined}
            className={
              classic
                ? `rounded-full px-5 py-2.5 text-lg font-medium transition-colors ${active ? "bg-paper text-ink" : "text-paper hover:bg-raised"}`
                : `relative rounded-md px-2.5 py-1.5 text-[0.95rem] font-bold transition-colors ${active ? "text-paper" : "text-muted hover:text-paper"}`
            }
          >
            {item.label}
            {!classic && active ? (
              <span className="absolute inset-x-2.5 -bottom-[19px] h-px bg-amber" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
