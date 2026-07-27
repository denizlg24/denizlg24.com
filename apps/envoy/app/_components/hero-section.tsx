import { Button } from "@repo/ui/button";
import { ArrowUpRight, GitCommitHorizontal, KeyRound } from "lucide-react";
import Link from "next/link";
import { fetchLatestRelease } from "@/lib/github";
import { CommandText } from "./command-text";

export async function HeroSection() {
  const latestVersion = await fetchLatestRelease("denizlg24", "envoy");

  return (
    <section className="hero-grid relative mx-auto grid min-h-[calc(100svh-5rem)] w-full min-w-0 max-w-7xl grid-cols-[minmax(0,1fr)] border-x lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
      <div className="relative z-10 flex min-w-0 flex-col justify-center px-6 py-20 sm:px-10 lg:px-16 lg:py-28">
        <div className="mb-8 flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-status-good shadow-[0_0_0_4px_color-mix(in_srgb,var(--status-good)_15%,transparent)]" />
            {latestVersion ? `${latestVersion} available` : "open source"}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Git for secrets
          </span>
        </div>

        <h1 className="max-w-3xl text-balance font-calistoga text-5xl leading-[0.94] tracking-[-0.035em] text-foreground sm:text-7xl lg:text-[5.5rem]">
          Your{" "}
          <span className="italic text-accent-strong dark:text-accent">
            .env
          </span>
          ,
          <br />
          with a history.
        </h1>

        <p className="mt-7 max-w-xl text-balance text-base leading-7 text-muted-foreground sm:text-lg">
          Envoy gives environment files the workflow they were missing:
          encrypted staging, redacted diffs, atomic commits, and precise team
          access.
        </p>

        <div className="mt-9 max-w-2xl">
          <CommandText />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link
              href="https://github.com/denizlg24/envoy#readme"
              target="_blank"
              rel="noreferrer"
            >
              Read the docs
              <ArrowUpRight />
            </Link>
          </Button>
          <span className="px-2 font-mono text-xs text-muted-foreground">
            XChaCha20-Poly1305 · local-first encryption
          </span>
        </div>
      </div>

      <div className="relative flex min-h-[34rem] min-w-0 items-center justify-center border-t bg-surface/45 p-5 sm:p-10 lg:min-h-0 lg:border-t-0 lg:border-l">
        <div className="absolute inset-0 terminal-rings opacity-70" />
        <div className="terminal-window relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-[#536150] bg-[#252a25] shadow-[0_30px_90px_rgba(37,42,37,0.28)]">
          <div className="flex h-11 items-center justify-between border-b border-[#536150] px-4">
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-[#d4a373]" />
              <span className="size-2.5 rounded-full bg-[#d4b896]" />
              <span className="size-2.5 rounded-full bg-[#a1bc98]" />
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#778873]">
              ~/acme-api
            </span>
          </div>

          <div className="space-y-6 p-5 font-mono text-xs leading-6 text-[#d2dcb6] sm:p-7 sm:text-sm">
            <div>
              <p>
                <span className="select-none text-[#a1bc98]">$ </span>
                envy status
              </p>
              <div className="mt-2 border-l border-[#536150] pl-4">
                <p className="text-[#778873]">Changes staged for commit</p>
                <p>
                  <span className="mr-3 text-[#a1bc98]">new</span>.env
                </p>
                <p>
                  <span className="mr-3 text-[#d4b896]">mod</span>
                  .env.production
                </p>
              </div>
            </div>

            <div>
              <p>
                <span className="select-none text-[#a1bc98]">$ </span>
                envy diff --cached
              </p>
              <div className="mt-2 border-l border-[#536150] pl-4">
                <p className="text-[#778873]">@@ .env.production @@</p>
                <p className="text-[#d4a373]">
                  - DATABASE_URL=&lt;redacted:42&gt;
                </p>
                <p className="text-[#b8d4a3]">
                  + DATABASE_URL=&lt;redacted:58&gt;
                </p>
              </div>
            </div>

            <div>
              <p>
                <span className="select-none text-[#a1bc98]">$ </span>
                envy commit -m &quot;rotate production db&quot;
              </p>
              <p className="mt-2 text-[#b8d4a3]">
                [4b7f8a1] 2 encrypted files committed
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 border-t border-[#536150] text-[#778873]">
            <div className="flex items-center gap-2 border-r border-[#536150] px-5 py-3 font-mono text-[10px] uppercase tracking-wider">
              <KeyRound className="size-3.5 text-[#a1bc98]" />
              keys stay local
            </div>
            <div className="flex items-center gap-2 px-5 py-3 font-mono text-[10px] uppercase tracking-wider">
              <GitCommitHorizontal className="size-3.5 text-[#a1bc98]" />
              commit 4b7f8a1
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
