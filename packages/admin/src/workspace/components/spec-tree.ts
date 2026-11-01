import {
  UI_CONTAINER_TYPES,
  type UiNode,
  type UiNodeType,
} from "@repo/schemas";

export function nodeId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export function isContainerNode(node: UiNode): boolean {
  return UI_CONTAINER_TYPES.includes(node.type);
}

/** A fresh node of `type` with enough filled in to show something. */
export function createNode(type: UiNodeType): UiNode {
  const id = nodeId();
  switch (type) {
    case "stack":
    case "row":
    case "list":
      return { id, type, children: [] };
    case "grid":
      return { id, type, columns: 2, children: [] };
    case "card":
      return { id, type, surface: "surface", children: [] };
    case "text":
      return { id, type, text: "Text" };
    case "heading":
      return { id, type, text: "Heading", level: 2 };
    case "stat":
      return { id, type, text: "Label", value: "0" };
    case "badge":
      return { id, type, text: "Badge", tone: "accent" };
    case "icon":
      return { id, type, icon: "icon:star" };
    case "image":
      return { id, type, href: "" };
    case "progress":
      return { id, type, text: "Progress", value: "40", max: "100" };
    case "divider":
    case "spacer":
      return { id, type };
    case "link":
      return { id, type, text: "Link", href: "https://" };
    case "button":
      return { id, type, text: "Open", href: "https://" };
    case "chart":
      return {
        id,
        type,
        value: "{{data.rows}}",
        chart: { kind: "bar", x: "label", y: ["value"] },
      };
    case "countdown":
      return { id, type, value: "2026-12-25", text: "to go" };
    case "clock":
      return { id, type, text: "HH:mm" };
    case "markdown":
      return { id, type, text: "**Markdown**" };
  }
}

export function findNode(root: UiNode, id: string): UiNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

export function parentOf(root: UiNode, id: string): UiNode | null {
  for (const child of root.children ?? []) {
    if (child.id === id) return root;
    const hit = parentOf(child, id);
    if (hit) return hit;
  }
  return null;
}

function mapTree(root: UiNode, fn: (node: UiNode) => UiNode): UiNode {
  const next = fn(root);
  if (!next.children) return next;
  return { ...next, children: next.children.map((c) => mapTree(c, fn)) };
}

export function replaceNode(root: UiNode, id: string, node: UiNode): UiNode {
  return mapTree(root, (n) => (n.id === id ? node : n));
}

export function appendChild(
  root: UiNode,
  parentId: string,
  node: UiNode,
): UiNode {
  return mapTree(root, (n) =>
    n.id === parentId ? { ...n, children: [...(n.children ?? []), node] } : n,
  );
}

export function insertAfter(
  root: UiNode,
  siblingId: string,
  node: UiNode,
): UiNode {
  return mapTree(root, (n) => {
    const children = n.children;
    if (!children?.some((c) => c.id === siblingId)) return n;
    const index = children.findIndex((c) => c.id === siblingId);
    return {
      ...n,
      children: [
        ...children.slice(0, index + 1),
        node,
        ...children.slice(index + 1),
      ],
    };
  });
}

export function removeNode(root: UiNode, id: string): UiNode {
  return mapTree(root, (n) =>
    n.children?.some((c) => c.id === id)
      ? { ...n, children: n.children.filter((c) => c.id !== id) }
      : n,
  );
}

export function moveNode(root: UiNode, id: string, delta: -1 | 1): UiNode {
  return mapTree(root, (n) => {
    const children = n.children;
    const index = children?.findIndex((c) => c.id === id) ?? -1;
    if (!children || index < 0) return n;
    const target = index + delta;
    if (target < 0 || target >= children.length) return n;
    const next = [...children];
    [next[index], next[target]] = [next[target], next[index]];
    return { ...n, children: next };
  });
}

/** A copy with fresh ids throughout. */
export function cloneNode(node: UiNode): UiNode {
  return {
    ...node,
    id: nodeId(),
    ...(node.children ? { children: node.children.map(cloneNode) } : {}),
  };
}
