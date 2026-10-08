/**
 * Screens the text of a food before it joins the shared catalogue. A food that
 * fails is still created — privately, for the person who made it — so a false
 * positive costs sharing, never the user's data.
 *
 * Words match whole tokens after folding case, accents and common character
 * swaps, so "Scunthorpe" and "class" pass while "a$$hole" does not.
 */

export type ContentFilterVerdict =
  | { ok: true }
  | { ok: false; reason: "language" | "link" | "contact" };

const BLOCKED_WORDS = new Set([
  // English
  "anal",
  "anus",
  "arse",
  "arsehole",
  "asshole",
  "bastard",
  "bitch",
  "bollocks",
  "boner",
  "bullshit",
  "chink",
  "clit",
  "cock",
  "cocksucker",
  "coon",
  "cum",
  "cunt",
  "dick",
  "dickhead",
  "dildo",
  "dyke",
  "fag",
  "faggot",
  "fuck",
  "fucked",
  "fucker",
  "fucking",
  "gook",
  "handjob",
  "hitler",
  "jizz",
  "kike",
  "motherfucker",
  "nazi",
  "nigga",
  "nigger",
  "paki",
  "penis",
  "porn",
  "pussy",
  "rape",
  "retard",
  "shit",
  "slut",
  "spic",
  "tits",
  "tranny",
  "twat",
  "vagina",
  "wank",
  "wanker",
  "whore",
  // Portuguese
  "buceta",
  "caralho",
  "cona",
  "cu",
  "foda",
  "foder",
  "fodase",
  "merda",
  "paneleiro",
  "pica",
  "piroca",
  "porra",
  "puta",
  "viado",
  // Spanish
  "cabron",
  "cojones",
  "joder",
  "maricon",
  "pendejo",
  "polla",
  "puto",
  // Danish
  "fisse",
  "kusse",
  "luder",
  "pik",
  // German
  "arschloch",
  "fotze",
  "hure",
  "schlampe",
  "wichser",
]);

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
};

const LINK =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|me|ly|gg|xyz|app|shop|link)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// Seven or more digits in a run (allowing separators) reads as a phone number;
// product names carry short numbers ("0% fat", "330 ml"), not that.
const PHONE = /(?:\+?\d[\s().-]?){7,}/;

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function tokens(text: string): string[] {
  const folded = fold(text);
  const swapped = folded.replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
  // Both spellings: "f.u.c.k" collapses when separators are dropped, and the
  // swapped form catches digits standing in for letters.
  const variants = [folded, swapped, swapped.replace(/[.\-_*]/g, "")];
  return variants.flatMap((variant) =>
    variant.split(/[^\p{L}]+/u).filter(Boolean),
  );
}

function hasBlockedWord(text: string): boolean {
  return tokens(text).some((token) => {
    if (BLOCKED_WORDS.has(token)) return true;
    // Repeated letters ("fuuuck") collapse to one before a second look.
    const squeezed = token.replace(/(\p{L})\1+/gu, "$1");
    return squeezed !== token && BLOCKED_WORDS.has(squeezed);
  });
}

export function screenSharedFoodText(
  ...fields: (string | null | undefined)[]
): ContentFilterVerdict {
  for (const field of fields) {
    if (!field) continue;
    if (EMAIL.test(field) || PHONE.test(field)) {
      return { ok: false, reason: "contact" };
    }
    if (LINK.test(field)) return { ok: false, reason: "link" };
    if (hasBlockedWord(field)) return { ok: false, reason: "language" };
  }
  return { ok: true };
}
