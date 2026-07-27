import { ArrowUpRight, GitFork, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ApiStatusComponent } from "./_components/api-status-component";
import { GettingStartedSection } from "./_components/getting-started-section";
import { HeroSection } from "./_components/hero-section";

const FEATURES = [
  {
    eyebrow: "one passphrase",
    title: "A keyring, not a key pile.",
    copy: "Every managed file gets an independent key derived locally from one project passphrase.",
    icon: LockKeyhole,
  },
  {
    eyebrow: "per-file access",
    title: "Share only what belongs.",
    copy: "Grant each collaborator access to the exact encrypted blobs they need. Owners stay in control.",
    icon: ShieldCheck,
  },
  {
    eyebrow: "git semantics",
    title: "The workflow you know.",
    copy: "Stage, diff, commit, push, pull, and remove secrets with the same mental model as Git.",
    icon: ArrowUpRight,
  },
] as const;

export default function Home() {
  return (
    <main className="overflow-hidden">
      <header className="relative z-20 mx-auto flex h-20 w-full min-w-0 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="font-calistoga text-xl tracking-tight text-foreground"
        >
          envoy<span className="text-accent">.</span>
        </Link>
        <nav
          aria-label="Primary navigation"
          className="flex items-center gap-1"
        >
          <Link
            href="#workflow"
            className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            Workflow
          </Link>
          <Link
            href="#status"
            className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            Status
          </Link>
          <Link
            href="https://github.com/denizlg24/denizlg24.com/tree/main/apps/envoy-cli"
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-surface"
          >
            <GitFork className="size-4" />
            GitHub
          </Link>
        </nav>
      </header>

      <HeroSection />

      <section
        aria-label="Core capabilities"
        className="relative z-10 mx-auto grid w-full min-w-0 max-w-7xl border-x border-t bg-background md:grid-cols-3"
      >
        {FEATURES.map(({ copy, eyebrow, icon: Icon, title }) => (
          <article
            key={eyebrow}
            className="group border-b p-7 transition-colors hover:bg-surface/60 md:border-r md:p-9 md:last:border-r-0"
          >
            <div className="mb-12 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {eyebrow}
              </span>
              <Icon className="size-4 text-accent-strong transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 dark:text-accent" />
            </div>
            <h2 className="font-calistoga text-2xl text-foreground">{title}</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
              {copy}
            </p>
          </article>
        ))}
      </section>

      <GettingStartedSection />
      <ApiStatusComponent />

      <footer className="mx-auto flex w-full max-w-7xl flex-col gap-4 border-x border-t px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>Open source secret versioning by Deniz Lopes Güneş.</p>
        <div className="flex items-center gap-5">
          <Link
            href="https://crates.io/crates/envoy-cli"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            crates.io
          </Link>
          <Link
            href="https://github.com/denizlg24/denizlg24.com/tree/main/apps/envoy-cli"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Source
          </Link>
        </div>
      </footer>
    </main>
  );
}
