import type { TriageCategory } from "@/models/EmailTriage";

export interface ShortcutRule {
  pattern: string;
  category: TriageCategory;
  confidence: number;
  needsTaskExtraction: boolean;
  needsEventExtraction: boolean;
}

const SHORTCUT_RULES: ShortcutRule[] = [
  {
    pattern: "*@vercel-status.com",
    category: "fyi",
    confidence: 0.99,
    needsTaskExtraction: false,
    needsEventExtraction: false,
  },
];

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function matchesPattern(pattern: string, address: string): boolean {
  const normalizedPattern = normalizeAddress(pattern);
  const normalizedAddress = normalizeAddress(address);

  if (normalizedPattern.startsWith("*@")) {
    return normalizedAddress.endsWith(normalizedPattern.slice(1));
  }

  return normalizedAddress === normalizedPattern;
}

export function findTriageShortcut(
  addresses: Array<string | undefined>,
): ShortcutRule | undefined {
  const normalizedAddresses = addresses
    .filter((address): address is string => typeof address === "string")
    .map(normalizeAddress)
    .filter(Boolean);

  for (const rule of SHORTCUT_RULES) {
    if (
      normalizedAddresses.some((address) =>
        matchesPattern(rule.pattern, address),
      )
    ) {
      return rule;
    }
  }

  return undefined;
}
