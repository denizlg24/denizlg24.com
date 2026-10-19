"use client";

import { cn } from "@repo/ui/utils";
import Link from "next/link";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { container } from "@/app/_landing/site";

const AccountDeleted = createContext<() => void>(() => {});

export function useMarkAccountDeleted() {
  return useContext(AccountDeleted);
}

/**
 * Swaps the whole page for the outcome once the account is gone: the session
 * cookie is already cleared, so refreshing would only show a sign-in form.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  const [deleted, setDeleted] = useState(false);
  if (deleted) return <AccountDeletedNotice />;
  return (
    <AccountDeleted value={() => setDeleted(true)}>{children}</AccountDeleted>
  );
}

function AccountDeletedNotice() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <div className={cn(container, "pt-14 pb-24 sm:pt-20")}>
      <div className="max-w-2xl">
        <p className="eyebrow">Account</p>
        <h1
          ref={heading}
          tabIndex={-1}
          className="mt-4 text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.04] font-semibold tracking-[-0.04em] outline-none"
        >
          Account deleted
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground text-pretty">
          Your account and everything in it are gone, on the web and in the app.
          You’ve been signed out.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex text-[15px] font-semibold underline decoration-border underline-offset-[6px] transition-colors hover:decoration-foreground"
        >
          Back to Macros
        </Link>
      </div>
    </div>
  );
}
