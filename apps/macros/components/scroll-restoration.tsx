"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const PREFIX = "macros.scroll.";

export function ScrollRestoration() {
  const pathname = usePathname();
  useEffect(() => {
    const key = `${PREFIX}${pathname}`;
    const stored = Number(sessionStorage.getItem(key));
    if (Number.isFinite(stored) && stored > 0) {
      requestAnimationFrame(() => window.scrollTo({ top: stored }));
    }
    const save = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
    };
  }, [pathname]);
  return null;
}
