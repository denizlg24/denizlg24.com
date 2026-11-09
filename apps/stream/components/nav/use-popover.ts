"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Open/close for a nav dropdown: closes on outside press, Escape and navigation. */
export function usePopover<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<T>(null);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      root.current
        ?.querySelector<HTMLElement>("[data-popover-trigger]")
        ?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, root };
}
