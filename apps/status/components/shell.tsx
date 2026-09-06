import Link from "next/link";
import { ThemeToggle } from "./live";

const tabs = [
  ["/", "Status"],
  ["/backups", "Backups"],
  ["/maintenance", "Maintenance"],
  ["/incidents", "Previous incidents"],
];
export function PageNav({ active }: { active: string }) {
  return (
    <nav className="page-nav" aria-label="Status navigation">
      {tabs.map(([href, label]) => (
        <Link
          prefetch={false}
          key={href}
          href={href!}
          aria-current={active === href ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
export function Header() {
  return (
    <header className="site-header">
      <Link href="/" className="wordmark" aria-label="deniz status home">
        <img
          src="/status-icon.png"
          width="32"
          height="32"
          alt=""
          fetchPriority="high"
        />
        <span>
          deniz<span className="wordmark-light"> / status</span>
        </span>
      </Link>
      <div className="header-actions">
        <ThemeToggle />
        <Link prefetch={false} className="admin-link" href="/admin">
          Admin <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <a href="https://denizlg24.com">
        denizlg24.com <span aria-hidden="true">↗</span>
      </a>
      <span>Daily history in UTC</span>
    </footer>
  );
}
export function Loading() {
  return (
    <div className="loading-state" role="status">
      <span className="status-dot unknown" /> Loading…
    </div>
  );
}
