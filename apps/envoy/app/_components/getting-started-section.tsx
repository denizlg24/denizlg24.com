import { CopyButton } from "@repo/ui/copy-button";
import { Fingerprint, GitCompareArrows, UsersRound } from "lucide-react";

const STEPS = [
  {
    number: "01",
    title: "Initialize the ledger",
    body: "Create the project, authenticate with GitHub, and choose the one passphrase that protects its local keyring.",
    command: "envy init",
    icon: Fingerprint,
  },
  {
    number: "02",
    title: "Stage what changed",
    body: "Add one or many environment files, then inspect a structural diff where values remain redacted.",
    command: "envy add .env && envy diff --cached",
    icon: GitCompareArrows,
  },
  {
    number: "03",
    title: "Commit and collaborate",
    body: "Push encrypted history, invite project members, and narrow individual files to explicit collaborators.",
    command: 'envy commit -m "configure api" && envy push',
    icon: UsersRound,
  },
] as const;

export function GettingStartedSection() {
  return (
    <section
      id="workflow"
      className="relative mx-auto w-full max-w-7xl border-x bg-background px-6 py-24 sm:px-10 lg:px-16 lg:py-32"
    >
      <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
        <div className="lg:sticky lg:top-12 lg:self-start">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            familiar by design
          </p>
          <h2 className="mt-4 max-w-md font-calistoga text-4xl leading-tight text-foreground sm:text-5xl">
            From plaintext to protected history.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-6 text-muted-foreground">
            Envoy keeps encryption machinery out of the way and preserves the
            muscle memory of a normal Git workflow.
          </p>
        </div>

        <ol className="border-t">
          {STEPS.map(({ body, command, icon: Icon, number, title }) => (
            <li
              key={number}
              className="group grid gap-5 border-b py-9 sm:grid-cols-[3.5rem_1fr] sm:gap-7"
            >
              <div className="flex items-center justify-between sm:block">
                <span className="font-mono text-xs text-muted-foreground">
                  {number}
                </span>
                <Icon className="size-5 text-accent-strong sm:mt-8 dark:text-accent" />
              </div>
              <div>
                <h3 className="font-calistoga text-2xl text-foreground">
                  {title}
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
                <div className="mt-5 flex min-w-0 items-center gap-3 rounded-lg border bg-surface/60 px-4 py-3 font-mono text-xs">
                  <span className="select-none text-accent-strong dark:text-accent">
                    $
                  </span>
                  <code className="min-w-0 flex-1 truncate text-foreground">
                    {command}
                  </code>
                  <CopyButton value={command} label={`Copy step ${number}`} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
