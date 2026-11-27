import Link from "next/link";
import type { ReactNode } from "react";
import { DenizSignIn } from "@/components/sign-in-actions";
import { Wordmark } from "./animated-mark";

const sections = [
  { href: "/#terminal", label: "Terminal" },
  { href: "/#ask", label: "Assistant" },
  { href: "/#alerts", label: "Alerts" },
] as const;

export function MarketingNav({
  signIn,
  signedIn = false,
  current,
}: {
  signIn: boolean;
  signedIn?: boolean;
  current?: "pricing" | "enquire" | "privacy" | "terms";
}) {
  return (
    <header className="mk-nav" data-tone="night">
      <Link href="/" className="mk-brand" data-mark-hover>
        <Wordmark />
      </Link>
      <nav aria-label="Site">
        {sections.map((item) => (
          <a key={item.href} href={item.href} className="mk-nav-section">
            {item.label}
          </a>
        ))}
        <Link
          href="/pricing"
          aria-current={current === "pricing" ? "page" : undefined}
        >
          Pricing
        </Link>
        <Link
          href="/enquire"
          className="mk-nav-section"
          aria-current={current === "enquire" ? "page" : undefined}
        >
          Desks
        </Link>
      </nav>
      {signedIn ? (
        <Link href="/" className="mk-nav-cta">
          Open app
        </Link>
      ) : signIn ? (
        <DenizSignIn label="Sign in" size="default" />
      ) : null}
    </header>
  );
}

export function MarketingFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="mk-footer">
      {children}
      <div className="mk-footer-row">
        <Link href="/" className="mk-brand" data-mark-hover>
          <Wordmark size={18} trigger="view" />
        </Link>
        <nav aria-label="Footer">
          <Link href="/pricing">Pricing</Link>
          <Link href="/enquire">Desk enquiry</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
      <p className="mk-footer-meta">
        <span>For information only. Not investment advice.</span>
        <span>
          Filings: SEC EDGAR · Macro: FRED · Yields: U.S. Treasury · Factors:
          Kenneth R. French Data Library · Quotes and news: Yahoo Finance
        </span>
      </p>
    </footer>
  );
}

export function MarketingPage({ children }: { children: ReactNode }) {
  return <div className="mk">{children}</div>;
}
