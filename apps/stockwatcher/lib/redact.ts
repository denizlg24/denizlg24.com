/**
 * Scrubs personal data from the admin audit copy of a chat run. The user's
 * own thread is never passed through here: it is theirs, unredacted.
 * Heuristic by design — it errs toward hiding a number that was not
 * sensitive rather than showing one that was.
 */

export type RedactSubject = { name?: string | null; email?: string | null };

const passesLuhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

const streetWords =
  "Street|St\\.?|Avenue|Ave\\.?|Road|Rd\\.?|Boulevard|Blvd\\.?|Lane|Ln\\.?|Drive|Dr\\.?|Court|Ct\\.?|Place|Pl\\.?|Way";
const streetPrefixes =
  "Rua|Avenida|Av\\.|Travessa|Largo|Praça|Praca|Estrada|Alameda|Calle|Via|Rue|Straße|Strasse";

const rules: ReadonlyArray<
  readonly [RegExp, string | ((match: string) => string)]
> = [
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, "[secret]"],
  [
    /\b(?:sk|pk|rk|polar_[a-z]+|re|xox[abp])[-_][A-Za-z0-9_-]{16,}\b/g,
    "[secret]",
  ],
  [
    /\b((?:flex\s*)?(?:query\s*id|token)\b(?:\s+(?:is|was)\b)?\W{0,4})[A-Za-z0-9]{4,}/gi,
    "$1[secret]",
  ],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, "[iban]"],
  [
    /\b\d(?:[ -]?\d){12,18}\b/g,
    (match) => (passesLuhn(match.replace(/\D/g, "")) ? "[card]" : "[number]"),
  ],
  [
    /(?:\+|\b00)\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}\b/g,
    "[phone]",
  ],
  [/\(\d{3}\)\s?\d{3}-\d{4}\b|\b\d{3}-\d{3}-\d{4}\b/g, "[phone]"],
  [/\b[UDF]\d{6,8}\b/g, "[account]"],
  [/\b\d{10,}\b/g, "[number]"],
  [
    new RegExp(
      `\\b\\d{1,5}\\s+(?:[A-Z][\\w'.-]*\\s+){1,4}(?:${streetWords})(?=\\W|$)`,
      "g",
    ),
    "[address]",
  ],
  [
    new RegExp(
      `\\b(?:${streetPrefixes})\\s+[^\\n,;]{2,60}?(?:,?\\s*(?:n\\.?º|nº|no\\.?|#)?\\s*\\d{1,5}[A-Za-z]?)\\b`,
      "gi",
    ),
    "[address]",
  ],
  [/\b\d{4}-\d{3}\b/g, "[postcode]"],
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function namePattern(subject: RedactSubject | undefined): RegExp | null {
  const parts = new Set<string>();
  const local = subject?.email?.split("@")[0];
  for (const source of [subject?.name, local])
    for (const part of source?.split(/[\s._-]+/) ?? [])
      if (part.length >= 3) parts.add(part);
  if (!parts.size) return null;
  const alternatives = [...parts]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  return new RegExp(
    `(?<![\\p{L}\\d])(?:${alternatives})(?![\\p{L}\\d])`,
    "giu",
  );
}

export function redactText(text: string, subject?: RedactSubject): string {
  let out = text;
  for (const [pattern, replacement] of rules)
    out =
      typeof replacement === "string"
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement);
  const names = namePattern(subject);
  return names ? out.replace(names, "[name]") : out;
}

export function redactValue(value: unknown, subject?: RedactSubject): unknown {
  if (typeof value === "string") return redactText(value, subject);
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, subject));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactValue(item, subject),
      ]),
    );
  return value;
}
