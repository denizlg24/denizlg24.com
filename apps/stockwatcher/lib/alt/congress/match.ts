import type { Politician } from "./types";

export type Legislator = Politician & {
  first: string;
  last: string;
  nickname: string | null;
};

const letters = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

const firstWord = (value: string) =>
  letters(
    value
      .trim()
      .split(/[\s.]+/)
      .find((word) => letters(word).length > 0) ?? "",
  );

export type Filer = {
  first: string;
  last: string;
  chamber: "house" | "senate";
  state?: string | null;
};

/** The sitting member a disclosure filer is, or null (former members and ambiguous names stay unmatched). */
export function matchLegislator(
  list: readonly Legislator[],
  filer: Filer,
): Legislator | null {
  const last = letters(filer.last);
  if (!last) return null;
  const pool = list.filter(
    (l) =>
      l.chamber === filer.chamber &&
      (!filer.state || l.state === filer.state) &&
      (letters(l.last) === last ||
        letters(l.last).endsWith(last) ||
        last.endsWith(letters(l.last))),
  );
  if (pool.length === 1) return pool[0];
  const first = firstWord(filer.first);
  if (!first) return null;
  const named = pool.filter((l) => {
    const names = [
      firstWord(l.first),
      l.nickname ? firstWord(l.nickname) : "",
    ].filter(Boolean);
    return names.some(
      (name) =>
        name === first ||
        (first.length >= 3 &&
          (name.startsWith(first) || first.startsWith(name))),
    );
  });
  return named.length === 1 ? named[0] : null;
}

export const displayName = (first: string, last: string, suffix = "") =>
  [first, last, suffix].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
