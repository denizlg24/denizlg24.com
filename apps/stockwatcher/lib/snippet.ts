const snippetRadius = 70;

/** Text around the first case-insensitive match, trimmed to whole words. */
export function snippetAround(text: string, query: string): string | null {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return null;
  const start = Math.max(0, at - snippetRadius);
  const end = Math.min(text.length, at + query.length + snippetRadius);
  const body = text
    .slice(start, end)
    .replace(/\s+/g, " ")
    .replace(/^\S*\s/, start > 0 ? "" : "$&")
    .replace(/\s\S*$/, end < text.length ? "" : "$&")
    .trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}
