/**
 * Recomputes every visible code once a second.
 *
 * Cheap enough to brute-force: an HMAC per account per tick is nothing next to
 * the render, and it keeps the countdown and the code from ever disagreeing.
 */

import { useEffect, useState } from "react";
import { type GeneratedCode, generateCode } from "../lib/totp";
import type { VaultEntry } from "../lib/types";

export type CodeMap = Record<string, GeneratedCode | undefined>;

function computeAll(entries: VaultEntry[]): CodeMap {
  const now = Date.now();
  const codes: CodeMap = {};

  for (const entry of entries) {
    try {
      codes[entry.id] = generateCode(entry, now);
    } catch {
      // A malformed secret shows as a dash rather than taking the popup down.
      codes[entry.id] = undefined;
    }
  }

  return codes;
}

export function useCodes(entries: VaultEntry[]): CodeMap {
  const [codes, setCodes] = useState<CodeMap>(() => computeAll(entries));

  useEffect(() => {
    setCodes(computeAll(entries));
    const timer = setInterval(() => setCodes(computeAll(entries)), 1000);
    return () => clearInterval(timer);
  }, [entries]);

  return codes;
}
