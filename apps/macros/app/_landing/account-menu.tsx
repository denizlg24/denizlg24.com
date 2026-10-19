"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

interface Viewer {
  name: string;
  email: string;
  image: string | null;
}

/**
 * `undefined` until the first session answer. Better Auth reports a signed-out
 * session as pending again on every refetch (window focus), so once settled the
 * last answer stands rather than blanking the slot each time.
 */
function useViewer(): Viewer | null | undefined {
  const { data, isPending } = authClient.useSession();
  const [settled, setSettled] = useState(!isPending);
  if (!isPending && !settled) setSettled(true);

  if (!settled) return undefined;
  if (!data) return null;
  return {
    name: data.user.name,
    email: data.user.email,
    image: data.user.image ?? null,
  };
}

function useSignOut(beforeSignOut: () => void) {
  const router = useRouter();
  return async () => {
    beforeSignOut();
    await authClient.signOut();
    router.refresh();
  };
}

function initialOf(viewer: Viewer) {
  const [first] = Array.from((viewer.name || viewer.email).trim());
  return first?.toLocaleUpperCase() ?? "";
}

function currentFor(pathname: string, href: string) {
  return pathname === href ? "page" : undefined;
}

const ACCOUNT_LINKS = [
  { href: "/kitchen", label: "Your recipes" },
  { href: "/account", label: "Account" },
] as const;

/** Fixed width, so the header holds still whichever state it lands on. */
const slot =
  "hidden h-9 w-[4.75rem] flex-none items-center justify-center sm:flex";

export function AccountSlot() {
  const viewer = useViewer();
  const pathname = usePathname();

  return (
    <div className={slot}>
      {viewer === null ? (
        <Link
          href="/account"
          aria-current={currentFor(pathname, "/account")}
          className="rounded-full px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"
        >
          Sign in
        </Link>
      ) : viewer ? (
        <AccountMenu viewer={viewer} />
      ) : null}
    </div>
  );
}

function AccountMenu({ viewer }: { viewer: Viewer }) {
  const pathname = usePathname();
  // Keyed by the page it opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const focusOnOpen = useRef<"first" | "last">("first");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const buttonId = useId();
  const menuId = useId();

  const items = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );

  const close = (returnFocus: boolean) => {
    setOpenOn(null);
    if (returnFocus) button.current?.focus();
  };
  const signOut = useSignOut(() => close(true));

  useEffect(() => {
    if (!open) return;
    const list = items();
    (focusOnOpen.current === "last" ? list.at(-1) : list[0])?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setOpenOn(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const openWith = (focus: "first" | "last") => {
    focusOnOpen.current = focus;
    setOpenOn(pathname);
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openWith(event.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const active = document.activeElement;
    const index = active instanceof HTMLElement ? list.indexOf(active) : -1;
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  };

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        // Tabbing away closes it; a null target (a click on nothing
        // focusable) is left to the pointer handler above.
        const next = event.relatedTarget;
        if (next instanceof Node && !root.current?.contains(next)) {
          setOpenOn(null);
        }
      }}
    >
      <button
        ref={button}
        id={buttonId}
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openWith("first"))}
        onKeyDown={onButtonKeyDown}
        className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-ios-tertiary-fill text-[13px] font-semibold text-foreground shadow-[0_0_0_0.5px_rgb(0_0_0/0.12)] transition-[box-shadow] hover:shadow-[0_0_0_1.5px_var(--border)] aria-expanded:shadow-[0_0_0_1.5px_var(--foreground)] dark:shadow-[0_0_0_0.5px_rgb(255_255_255/0.16)]"
      >
        {viewer.image ? (
          <img src={viewer.image} alt="" className="size-full object-cover" />
        ) : (
          <span aria-hidden="true">{initialOf(viewer)}</span>
        )}
      </button>
      {open ? (
        <div className="absolute top-full right-0 mt-2.5 w-64 rounded-[14px] bg-background py-1.5 shadow-[0_0_0_0.5px_var(--border),0_18px_40px_-16px_rgb(0_0_0/0.28)] dark:shadow-[0_0_0_1px_var(--border),0_18px_40px_-16px_rgb(0_0_0/0.9)]">
          <div className="border-b px-4 pt-2 pb-3">
            <p className="truncate text-sm font-semibold">{viewer.name}</p>
            <p className="truncate text-[13px] text-muted-foreground">
              {viewer.email}
            </p>
          </div>
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-labelledby={buttonId}
            onKeyDown={onMenuKeyDown}
            className="pt-1.5"
          >
            {ACCOUNT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                tabIndex={-1}
                aria-current={currentFor(pathname, link.href)}
                onClick={() => close(false)}
                className={menuItem}
              >
                {link.label}
              </Link>
            ))}
            <div role="separator" className="my-1.5 border-t" />
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => void signOut()}
              className={menuItem}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const menuItem =
  "flex w-full items-center px-4 py-2 text-left text-[15px] text-muted-foreground transition-colors outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:bg-foreground/5 focus-visible:text-foreground aria-[current=page]:text-foreground";

/** The same choices inside the phone menu panel. */
export function AccountLinks({ onNavigate }: { onNavigate: () => void }) {
  const viewer = useViewer();
  const pathname = usePathname();
  const signOut = useSignOut(onNavigate);
  if (viewer === undefined) return null;

  return (
    <nav aria-label="Account" className="mt-10">
      <p className="eyebrow">Account</p>
      {viewer ? (
        <p className="mt-2 truncate text-sm text-muted-foreground">
          {viewer.email}
        </p>
      ) : null}
      <ul className="mt-3 flex flex-col border-t">
        {viewer ? (
          <>
            {ACCOUNT_LINKS.map((link) => (
              <li key={link.href} className="border-b">
                <Link
                  href={link.href}
                  aria-current={currentFor(pathname, link.href)}
                  onClick={onNavigate}
                  className={panelRow}
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="border-b">
              <button
                type="button"
                onClick={() => void signOut()}
                className={panelRow}
              >
                Sign out
              </button>
            </li>
          </>
        ) : (
          <li className="border-b">
            <Link
              href="/account"
              aria-current={currentFor(pathname, "/account")}
              onClick={onNavigate}
              className={panelRow}
            >
              Sign in
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}

const panelRow =
  "flex w-full items-center py-3.5 text-left text-[17px] font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground";
