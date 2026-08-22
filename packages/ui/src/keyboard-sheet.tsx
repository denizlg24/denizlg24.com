"use client";

import * as React from "react";
import { type DialogProps, Drawer as DrawerPrimitive } from "vaul";

import {
  DrawerClose,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer";
import { useKeyboardInset } from "./hooks/use-keyboard-inset";
import { cn } from "./utils";

type KeyboardSheetProps = Omit<
  DialogProps,
  "fadeFromIndex" | "repositionInputs"
> & {
  fadeFromIndex?: never;
};

export function KeyboardSheet(props: KeyboardSheetProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    props.defaultOpen ?? false,
  );
  const open = props.open ?? uncontrolledOpen;
  const { isOpen: keyboardOpen } = useKeyboardInset();

  React.useEffect(() => {
    if (!open) return;

    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo({ top: scrollY, behavior: "instant" });
    };
  }, [open]);

  React.useEffect(() => {
    if (!(open && keyboardOpen)) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      requestAnimationFrame(() => {
        const sheet = active.closest<HTMLElement>(
          '[data-slot="keyboard-sheet-content"]',
        );
        const activeRect = active.getBoundingClientRect();
        const sheetRect = sheet?.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop ?? 0;
        const viewportBottom =
          viewportTop + (viewport?.height ?? window.innerHeight);
        const visibleTop = Math.max(sheetRect?.top ?? 0, viewportTop) + 16;
        const visibleBottom =
          Math.min(sheetRect?.bottom ?? viewportBottom, viewportBottom) - 16;

        if (activeRect.top < visibleTop || activeRect.bottom > visibleBottom) {
          active.scrollIntoView({ block: "nearest", behavior: "instant" });
        }
      });
    }
  }, [keyboardOpen, open]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setUncontrolledOpen(nextOpen);
      props.onOpenChange?.(nextOpen);
    },
    [props.onOpenChange],
  );

  // Input repositioning is owned by useKeyboardInset; enabling vaul's
  // competing scroll manipulation causes visible jitter on iOS.
  return (
    <DrawerPrimitive.Root
      {...props}
      onOpenChange={handleOpenChange}
      repositionInputs={false}
    />
  );
}

export function KeyboardSheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="keyboard-sheet-content"
        className={cn(
          "group/keyboard-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[min(var(--keyboard-sheet-snap,100dvh),calc(100dvh-var(--kb-inset,0px)))] flex-col rounded-t-xl border-t bg-background text-foreground outline-none",
          "overscroll-contain [touch-action:pan-y] motion-reduce:transition-none",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-3 h-1.5 w-24 shrink-0 rounded-full bg-muted" />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

// Compatibility aliases make migration from the stock drawer mechanical while
// still ensuring every form drawer uses the keyboard-aware root and content.
export const Drawer = KeyboardSheet;
export const DrawerContent = KeyboardSheetContent;
export {
  DrawerClose,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
