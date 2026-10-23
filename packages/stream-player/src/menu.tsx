import { Check } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ControlButton } from "./control-button";
import { cx, insetFocusRing } from "./styles";

export interface MenuItem {
  value: string;
  label: string;
}

export interface PlayerMenuProps {
  label: string;
  triggerLabel?: string;
  trigger: ReactNode;
  items: readonly MenuItem[];
  selected: string;
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (value: string) => void;
}

const CLOSE_KEYS = new Set(["Escape", "GoBack", "BrowserBack"]);

export function PlayerMenu({
  label,
  triggerLabel,
  trigger,
  items,
  selected,
  open,
  disabled = false,
  onOpenChange,
  onSelect,
}: PlayerMenuProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === selected),
  );
  const [active, setActive] = useState(selectedIndex);

  useEffect(() => {
    if (open) setActive(selectedIndex);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus({ preventScroll: true });
  }, [open, active]);

  const close = () => {
    onOpenChange(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const choose = (index: number) => {
    const item = items[index];
    if (item) onSelect(item.value);
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = items.length - 1;
    const move = (index: number) => {
      event.preventDefault();
      setActive(index);
    };
    if (event.key === "ArrowDown") move(active >= last ? 0 : active + 1);
    else if (event.key === "ArrowUp") move(active <= 0 ? last : active - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(last);
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (CLOSE_KEYS.has(event.key) || event.key === "Tab") {
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      className="relative"
      data-player-menu=""
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (
          open &&
          next instanceof Node &&
          !event.currentTarget.contains(next)
        ) {
          onOpenChange(false);
        }
      }}
    >
      <ControlButton
        ref={triggerRef}
        label={triggerLabel ?? label}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        {trigger}
      </ControlButton>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute right-0 bottom-full z-40 mb-3 max-h-[60vh] min-w-52 overflow-y-auto rounded-lg bg-neutral-950/90 py-2 backdrop-blur-md lg:min-w-64"
        >
          <p
            aria-hidden="true"
            className="px-4 pt-1 pb-2 font-medium text-white/50 text-xs uppercase tracking-[0.18em] lg:text-sm"
          >
            {label}
          </p>
          {items.map((item, index) => {
            const checked = item.value === selected;
            return (
              <button
                key={item.value}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={index === active ? 0 : -1}
                onClick={() => choose(index)}
                onPointerEnter={() => setActive(index)}
                className={cx(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-base text-white/75 hover:bg-white/10 aria-checked:text-white lg:py-3 lg:text-xl",
                  insetFocusRing,
                )}
              >
                <span className="inline-flex size-5 shrink-0 items-center justify-center lg:size-6">
                  {checked && <Check className="size-5 lg:size-6" />}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
