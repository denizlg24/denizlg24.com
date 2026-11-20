type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };
type Item = { id: string; parentId: string | null };

export const CARD_WIDTH = 306;
export const CARD_HEIGHT = 190;
const COLUMN_GAP = 110;
const SIBLING_GAP = 28;
const TREE_GAP = 64;
const ORIGIN = { x: 120, y: 120 };

// Trees grow rightwards: each parent sits at the vertical centre of its
// children's band, and every subtree owns a band no other subtree enters,
// so neither cards nor edges can cross. Roots stack top to bottom.
export function treeLayout(
  items: Item[],
  heights: Map<string, number> = new Map(),
): Map<string, Point> {
  const ids = new Set(items.map((i) => i.id));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const item of items) {
    if (item.parentId && ids.has(item.parentId) && item.parentId !== item.id) {
      const list = children.get(item.parentId) ?? [];
      list.push(item.id);
      children.set(item.parentId, list);
    } else roots.push(item.id);
  }
  const height = (id: string) => heights.get(id) ?? CARD_HEIGHT;
  const band = new Map<string, number>();
  const visiting = new Set<string>();
  const measure = (id: string): number => {
    const known = band.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return height(id);
    visiting.add(id);
    const kids = children.get(id) ?? [];
    const stacked =
      kids.reduce((sum, kid) => sum + measure(kid), 0) +
      Math.max(0, kids.length - 1) * SIBLING_GAP;
    const total = Math.max(height(id), stacked);
    band.set(id, total);
    return total;
  };
  const placed = new Map<string, Point>();
  const place = (id: string, x: number, top: number) => {
    if (placed.has(id)) return;
    const total = measure(id);
    placed.set(id, { x, y: top + (total - height(id)) / 2 });
    const kids = children.get(id) ?? [];
    const stacked =
      kids.reduce((sum, kid) => sum + measure(kid), 0) +
      Math.max(0, kids.length - 1) * SIBLING_GAP;
    let cursor = top + (total - stacked) / 2;
    for (const kid of kids) {
      place(kid, x + CARD_WIDTH + COLUMN_GAP, cursor);
      cursor += measure(kid) + SIBLING_GAP;
    }
  };
  let top = ORIGIN.y;
  for (const root of roots) {
    place(root, ORIGIN.x, top);
    top += measure(root) + TREE_GAP;
  }
  return placed;
}

// Where a new card goes when the owner arranges by hand: beside its parent,
// or below everything, sliding down until it no longer touches a card.
export function freePosition(desired: Point, occupied: Box[]): Point {
  const position = { ...desired };
  const clear = () =>
    !occupied.some(
      (b) =>
        position.x < b.x + b.width + 40 &&
        b.x < position.x + CARD_WIDTH + 40 &&
        position.y < b.y + b.height + SIBLING_GAP &&
        b.y < position.y + CARD_HEIGHT + SIBLING_GAP,
    );
  while (!clear()) position.y += SIBLING_GAP + 20;
  return position;
}

// A grid that fills the window layer for "Tile windows".
export function tile(count: number, width: number, height: number): Box[] {
  if (!count) return [];
  const gap = 8;
  const cols =
    count <= 3 && width > height * 1.4 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const w = (width - gap * (cols + 1)) / cols;
  const h = (height - gap * (rows + 1)) / rows;
  return Array.from({ length: count }, (_, i) => ({
    x: gap + (i % cols) * (w + gap),
    y: gap + Math.floor(i / cols) * (h + gap),
    width: Math.floor(w),
    height: Math.floor(h),
  }));
}
