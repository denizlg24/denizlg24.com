import type { ComponentPropsWithRef } from "react";
import { cx, disabledLook, focusRing } from "./styles";

export interface ControlButtonProps
  extends Omit<ComponentPropsWithRef<"button">, "disabled" | "aria-label"> {
  label: string;
  disabled?: boolean;
  wide?: boolean;
}

/** Disabled controls stay focusable: `aria-disabled`, never `disabled`. */
export function ControlButton({
  label,
  disabled = false,
  wide = false,
  onClick,
  className,
  children,
  ...rest
}: ControlButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-player-nav=""
      data-player-role="control"
      onClick={disabled ? undefined : onClick}
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center rounded-full text-white transition-colors",
        wide
          ? "h-10 gap-2 px-3 sm:h-12 lg:h-14 lg:px-4"
          : "size-10 sm:size-12 lg:size-14",
        "hover:bg-white/10 aria-disabled:hover:bg-transparent",
        focusRing,
        disabledLook,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
