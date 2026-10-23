export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const focusRing =
  "outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black";

export const insetFocusRing =
  "outline-none focus-visible:bg-white/15 focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-white";

export const iconSize = "size-6 sm:size-7 lg:size-8";

export const disabledLook =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
