/**
 * Generic, dependency-free traversal primitives for a parent-pointer forest of
 * nodes. Callers pass id/parent accessors; the core never assumes a concrete
 * node shape, so both string-`_id` (desktop) and ObjectId-coerced (web) callers
 * can share it. All traversal is cycle-guarded — a malformed parent cycle must
 * not infinite-loop.
 */

/** Build a `Map` from node id to node. */
export function indexById<T>(
  nodes: T[],
  getId: (node: T) => string,
): Map<string, T> {
  return new Map(nodes.map((node) => [getId(node), node] as const));
}

/**
 * Group nodes by their parent id (`null` for roots). When `compare` is given,
 * each child list is sorted in place.
 */
export function groupByParent<T>(
  nodes: T[],
  getParentId: (node: T) => string | null,
  compare?: (left: T, right: T) => number,
): Map<string | null, T[]> {
  const childrenByParent = new Map<string | null, T[]>();

  for (const node of nodes) {
    const parentId = getParentId(node);
    const current = childrenByParent.get(parentId) ?? [];
    current.push(node);
    childrenByParent.set(parentId, current);
  }

  if (compare) {
    for (const children of childrenByParent.values()) {
      children.sort(compare);
    }
  }

  return childrenByParent;
}

/**
 * Walk parent pointers from `startId` upward, returning ancestor ids in
 * near-to-far order. `includeSelf` toggles whether `startId` itself is the first
 * element (desktop) or excluded (web strict ancestors). `parentOf` returns the
 * parent id of a node, or `null` when there is no (known) parent.
 */
export function ancestorIds(
  startId: string,
  parentOf: (id: string) => string | null,
  opts: { includeSelf: boolean },
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  let current: string | null = opts.includeSelf ? startId : parentOf(startId);

  while (current && !visited.has(current)) {
    visited.add(current);
    result.push(current);
    current = parentOf(current);
  }

  return result;
}

/**
 * Collect the descendant id set under `rootId`. `includeRoot` toggles whether
 * `rootId` itself is part of the result (desktop `true`, web `false`).
 */
export function descendantIdSet<T>(
  rootId: string,
  childrenByParent: Map<string | null, T[]>,
  getId: (node: T) => string,
  opts: { includeRoot: boolean },
): Set<string> {
  const result = new Set<string>();
  if (opts.includeRoot) result.add(rootId);

  const visited = new Set<string>([rootId]);
  const stack: string[] = [rootId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;

    for (const child of childrenByParent.get(current) ?? []) {
      const childId = getId(child);
      if (visited.has(childId)) continue;
      visited.add(childId);
      result.add(childId);
      stack.push(childId);
    }
  }

  return result;
}
