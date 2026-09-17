"use client";

import type { ReactNode } from "react";
import { SessionGate, useSessionUser } from "./session-gate";
import { ShellFrame } from "./shell-frame";

function SignedInShell({ children }: { children: ReactNode }) {
  const user = useSessionUser();
  return <ShellFrame user={user}>{children}</ShellFrame>;
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      <SignedInShell>{children}</SignedInShell>
    </SessionGate>
  );
}
