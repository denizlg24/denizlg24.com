"use client";

import { Button } from "@repo/ui/button";
import { CopyButton } from "@repo/ui/copy-button";
import { useState } from "react";

const INSTALLERS = {
  cargo: {
    label: "Cargo",
    prompt: "$",
    command: "cargo install envoy-cli",
  },
  shell: {
    label: "Shell",
    prompt: "$",
    command:
      "curl -fsSL https://raw.githubusercontent.com/denizlg24/envoy/master/install.sh | sh",
  },
  powershell: {
    label: "PowerShell",
    prompt: "PS>",
    command:
      "iwr https://raw.githubusercontent.com/denizlg24/envoy/master/install.ps1 | iex",
  },
} as const;

type Installer = keyof typeof INSTALLERS;

export function CommandText() {
  const [installer, setInstaller] = useState<Installer>("cargo");
  const selected = INSTALLERS[installer];

  return (
    <div className="overflow-hidden rounded-xl border bg-background/90 shadow-sm backdrop-blur">
      <div
        className="flex items-center gap-1 border-b p-1.5"
        role="tablist"
        aria-label="Installation method"
      >
        {(
          Object.entries(INSTALLERS) as [
            Installer,
            (typeof INSTALLERS)[Installer],
          ][]
        ).map(([key, value]) => (
          <Button
            key={key}
            type="button"
            role="tab"
            aria-selected={installer === key}
            variant={installer === key ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setInstaller(key)}
          >
            {value.label}
          </Button>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-3 px-4 py-3.5 font-mono text-xs sm:text-sm">
        <span className="shrink-0 text-accent-strong dark:text-accent">
          {selected.prompt}
        </span>
        <code className="min-w-0 flex-1 truncate text-left text-foreground">
          {selected.command}
        </code>
        <CopyButton
          value={selected.command}
          label={`Copy ${selected.label} install command`}
        />
      </div>
    </div>
  );
}
