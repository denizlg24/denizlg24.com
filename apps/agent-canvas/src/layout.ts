type Point = { x: number; y: number };

// Card-sized collision boxes include room for edge routing and long activity
// labels. Existing/manual positions remain anchors when new agents arrive.
export function freePosition(desired: Point, occupied: Point[]): Point {
  let position = { ...desired };
  while (
    occupied.some(
      (p) =>
        Math.abs(p.x - position.x) < 352 && Math.abs(p.y - position.y) < 280,
    )
  ) {
    position = { x: position.x, y: position.y + 280 };
  }
  return position;
}
