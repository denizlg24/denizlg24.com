/**
 * The JavaScript twin of the database's `stream_fold`: lower case, accents
 * dropped, every run of punctuation a single space. Search compares folded
 * text on both sides, so "Amelie" finds "Amélie" and "spider man" finds
 * "Spider-Man".
 */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("&", " and ")
    .replaceAll("ß", "ss")
    .replaceAll("œ", "oe")
    .replaceAll("æ", "ae")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đ]/g, "d")
    .replace(/[ı]/g, "i")
    .replace(/[ł]/g, "l")
    .replace(/[ø]/g, "o")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every query word starts some word of the name, in any order. */
export function wordsPrefixMatch(query: string, name: string): boolean {
  const words = fold(name).split(" ");
  return fold(query)
    .split(" ")
    .filter((word) => word.length > 0)
    .every((part) => words.some((word) => word.startsWith(part)));
}
