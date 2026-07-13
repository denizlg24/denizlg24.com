const DENIED_FIELD_NAMES = new Set([
  "authorization",
  "cookie",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "privatekey",
  "private_key",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "recoverycode",
  "recovery_code",
]);

const DENIED_VALUE_PATTERNS: { category: string; pattern: RegExp }[] = [
  {
    category: "private-key",
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i,
  },
  {
    category: "authorization",
    pattern: /\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/i,
  },
  {
    category: "database-credential",
    pattern: /\bmongodb(?:\+srv)?:\/\/[^\s:/]+:[^\s@]+@/i,
  },
  {
    category: "jwt",
    pattern:
      /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  },
  {
    category: "github-token",
    pattern: /\b(?:gh[opusr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  },
  {
    category: "provider-token",
    pattern: /\b(?:sk|pk|rk|re)_[A-Za-z0-9_-]{24,}\b/,
  },
  {
    category: "assigned-secret",
    pattern:
      /\b(?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|recovery[_ -]?code)\s*(?:is|=|:)\s*["']?[^\s"']{8,}/i,
  },
];

const PERMISSION_PATTERNS = [
  /\bignore (?:all |any )?(?:previous|prior|system|developer) instructions\b/i,
  /\b(?:bypass|skip|disable|remove) (?:the )?(?:approval|confirmation|safety|permission)\b/i,
  /\b(?:do not|never) (?:ask for|require) (?:approval|confirmation|permission)\b/i,
  /\b(?:grant|give|has|have) (?:the )?(?:agent|assistant|you) permission\b/i,
  /\b(?:authorized|allowed) to (?:execute|run|delete|send|write|approve)\b/i,
  /\b(?:change|replace|override|rewrite) (?:the )?(?:system prompt|safety policy|tool policy)\b/i,
  /\bauto[- ]?approve\b/i,
];

export interface DeniedContentMatch {
  category: string;
  path: string;
}

function scanValue(
  value: unknown,
  path: string,
  matches: DeniedContentMatch[],
  seen: Set<unknown>,
) {
  if (typeof value === "string") {
    for (const { category, pattern } of DENIED_VALUE_PATTERNS) {
      if (pattern.test(value)) matches.push({ category, path });
    }
    return;
  }

  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      scanValue(value[index], `${path}[${index}]`, matches, seen);
    }
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replaceAll("-", "_");
    const nestedPath = path ? `${path}.${key}` : key;
    if (
      DENIED_FIELD_NAMES.has(normalizedKey.replaceAll("_", "")) ||
      DENIED_FIELD_NAMES.has(normalizedKey)
    ) {
      matches.push({ category: "secret-field", path: nestedPath });
      continue;
    }
    scanValue(nested, nestedPath, matches, seen);
  }
}

export function findDeniedContent(value: unknown): DeniedContentMatch[] {
  const matches: DeniedContentMatch[] = [];
  scanValue(value, "value", matches, new Set());
  return matches;
}

export function containsPermissionLikeInstruction(value: string): boolean {
  return PERMISSION_PATTERNS.some((pattern) => pattern.test(value));
}

export function normalizeEvidenceText(
  value: string,
  maxLength = 8_192,
): string {
  return value
    .replaceAll("\0", "")
    .replaceAll(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}
