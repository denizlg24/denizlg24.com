import { type Genre, MAP_SIZE } from "@repo/schemas/stream";

/**
 * Hand-placed so neighbours make sense: the dark genres share the top-left,
 * spectacle the top, the gentle ones the right, history and documentary the
 * bottom, with drama and romance in the middle where most titles overlap.
 */
export const GENRE_ANCHORS: Record<Genre, readonly [number, number]> = {
  Horror: [1500, 1500],
  Thriller: [2800, 2300],
  Mystery: [2000, 3300],
  Crime: [3500, 3500],
  Action: [4400, 2500],
  "Sci-Fi": [5100, 1300],
  Fantasy: [6700, 1800],
  Adventure: [6000, 3000],
  Animation: [8400, 2500],
  Family: [8600, 3900],
  Comedy: [7200, 4400],
  Musical: [8800, 5600],
  Music: [8000, 6700],
  Romance: [6200, 5500],
  Drama: [4600, 5000],
  War: [1800, 5200],
  History: [2500, 6400],
  Western: [1200, 6900],
  Biography: [3700, 6900],
  Documentary: [5000, 8400],
  Sport: [6800, 7700],
};

const MOOD: Record<Genre, number> = {
  Family: -1,
  Comedy: -0.9,
  Animation: -0.8,
  Musical: -0.8,
  Music: -0.5,
  Romance: -0.5,
  Adventure: -0.4,
  Fantasy: -0.3,
  Sport: -0.3,
  Action: 0,
  "Sci-Fi": 0.1,
  Documentary: 0.2,
  Western: 0.2,
  Biography: 0.3,
  Mystery: 0.4,
  Drama: 0.4,
  History: 0.5,
  Crime: 0.6,
  Thriller: 0.7,
  War: 0.9,
  Horror: 1,
};

function isGenre(name: string): name is Genre {
  return name in GENRE_ANCHORS;
}

export function moodOf(genres: readonly string[]): number {
  const known = genres.filter(isGenre);
  if (known.length === 0) return 0;
  return known.reduce((sum, genre) => sum + MOOD[genre], 0) / known.length;
}

/** FNV-1a: stable across runs, so a title never moves between ingests. */
function hash(text: string, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

const SPREAD = 1100;

/** 1 for the most-voted titles on IMDb (~3M), 0 at the ingest floor. */
export function reach(votes: number): number {
  return Math.min(1, Math.max(0, (Math.log10(Math.max(votes, 1)) - 3) / 3.5));
}

export function mapPosition(
  id: string,
  genres: readonly string[],
  votes: number,
): { x: number; y: number } {
  const known = genres.filter(isGenre);
  const anchors = known.length > 0 ? known.map((g) => GENRE_ANCHORS[g]) : [];
  const [cx, cy] =
    anchors.length > 0
      ? [
          anchors.reduce((sum, [x]) => sum + x, 0) / anchors.length,
          anchors.reduce((sum, [, y]) => sum + y, 0) / anchors.length,
        ]
      : [MAP_SIZE / 2, MAP_SIZE * 0.95];
  const angle = hash(id, 1) * Math.PI * 2;
  const radius =
    SPREAD * (1 - reach(votes)) ** 0.7 * Math.sqrt(hash(id, 2)) + 40;
  const clamp = (value: number) => Math.min(MAP_SIZE, Math.max(0, value));
  return {
    x: clamp(cx + Math.cos(angle) * radius),
    y: clamp(cy + Math.sin(angle) * radius),
  };
}
