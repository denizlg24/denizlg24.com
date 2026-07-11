"use client";

import { useMemo } from "react";
import {
  KnowledgeGraph,
  type KnowledgeGraphLinkData,
  type KnowledgeGraphNodeData,
} from "@/components/graph/knowledge-graph";
import { classColor } from "@/lib/bookmark-color";

function themeScheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export interface EntityGraphGroup {
  _id: string;
  name: string;
  color?: string | null;
  parentId?: string | null;
}

export interface EntityGraphEdge {
  from: string;
  to: string;
  strength: number;
}

// Shared page-level plumbing: restrict groups/edges to what the (filtered)
// item set can actually reach, so notes and people graphs cannot diverge.
export function useEntityGraphData<
  TItem extends { _id: string },
  TGroup extends EntityGraphGroup,
  TEdge extends EntityGraphEdge,
>({
  items,
  groups,
  edges,
  getItemGroupIds,
}: {
  items: TItem[];
  groups: TGroup[];
  edges: TEdge[];
  getItemGroupIds: (item: TItem) => string[];
}): { visibleGroups: TGroup[]; visibleEdges: TEdge[] } {
  const visibleGroups = useMemo(() => {
    const byId = new Map(groups.map((group) => [group._id, group]));
    const visible = new Set<string>();
    for (const item of items) {
      for (const groupId of getItemGroupIds(item)) {
        let currentId: string | null | undefined = groupId;
        while (currentId) {
          if (visible.has(currentId)) break;
          visible.add(currentId);
          currentId = byId.get(currentId)?.parentId ?? null;
        }
      }
    }
    return groups.filter((group) => visible.has(group._id));
  }, [items, groups, getItemGroupIds]);

  const visibleEdges = useMemo(() => {
    const visibleIds = new Set(items.map((item) => item._id));
    return edges.filter(
      (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
    );
  }, [items, edges]);

  return { visibleGroups, visibleEdges };
}

const GROUP_ROOT_VAL_BASE = 14;
const GROUP_ROOT_VAL_PER_MEMBER = 2.2;
const GROUP_CHILD_VAL_BASE = 5;
const GROUP_CHILD_VAL_PER_MEMBER = 1.2;

interface Props<
  TItem extends { _id: string },
  TGroup extends EntityGraphGroup,
> {
  items: TItem[];
  groups: TGroup[];
  edges: EntityGraphEdge[];
  getItemLabel: (item: TItem) => string;
  getItemGroupIds: (item: TItem) => string[];
  getItemColor: (item: TItem, scheme: "dark" | "light") => string;
  getItemImage?: (item: TItem) => string | undefined;
  itemValBase?: number;
  itemValPerConnection?: number;
  /**
   * "connections" (default): items stay an order of magnitude below groups,
   * sized by decayed reach — right for notes, where items and folders are
   * different kinds of things. "group": items ARE groups semantically (a
   * person "contains" their network; "I" is the root of the people graph),
   * so they're sized on the group scale and the top hub can outgrow root
   * group nodes and read as the center.
   */
  itemSizing?: "connections" | "group";
  onSelectItem: (item: TItem) => void;
  onSelectGroup: (group: TGroup) => void;
  onItemContextMenu?: (item: TItem, event: MouseEvent) => void;
  onGroupContextMenu?: (group: TGroup, event: MouseEvent) => void;
  onBackgroundContextMenu?: (event: MouseEvent) => void;
}

export function EntityGraph<
  TItem extends { _id: string },
  TGroup extends EntityGraphGroup,
>({
  items,
  groups,
  edges,
  getItemLabel,
  getItemGroupIds,
  getItemColor,
  getItemImage,
  itemValBase = 0.75,
  itemValPerConnection = 0.28,
  itemSizing = "connections",
  onSelectItem,
  onSelectGroup,
  onItemContextMenu,
  onGroupContextMenu,
  onBackgroundContextMenu,
}: Props<TItem, TGroup>) {
  const data = useMemo(() => {
    const scheme = themeScheme();
    const visibleItemIds = new Set(items.map((item) => item._id));
    const directMemberCount = new Map<string, number>();

    for (const item of items) {
      for (const groupId of getItemGroupIds(item)) {
        directMemberCount.set(
          groupId,
          (directMemberCount.get(groupId) ?? 0) + 1,
        );
      }
    }

    const childrenByParent = new Map<string, TGroup[]>();
    for (const group of groups) {
      const parentId = group.parentId ?? null;
      if (!parentId) continue;
      const list = childrenByParent.get(parentId) ?? [];
      list.push(group);
      childrenByParent.set(parentId, list);
    }

    const subtreeMemberCount = new Map<string, number>();
    const computeSubtree = (groupId: string): number => {
      const cached = subtreeMemberCount.get(groupId);
      if (cached !== undefined) return cached;
      let total = directMemberCount.get(groupId) ?? 0;
      for (const child of childrenByParent.get(groupId) ?? []) {
        total += computeSubtree(child._id);
      }
      subtreeMemberCount.set(groupId, total);
      return total;
    };
    for (const group of groups) {
      computeSubtree(group._id);
    }

    const undirectedEdges: EntityGraphEdge[] = [];
    const seenPairs = new Set<string>();
    for (const edge of edges) {
      if (!visibleItemIds.has(edge.from) || !visibleItemIds.has(edge.to))
        continue;
      if (edge.from === edge.to) continue;
      const key =
        edge.from < edge.to
          ? `${edge.from}|${edge.to}`
          : `${edge.to}|${edge.from}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      undirectedEdges.push(edge);
    }

    const adjacency = new Map<string, string[]>();
    const addNeighbor = (from: string, to: string) => {
      const list = adjacency.get(from) ?? [];
      list.push(to);
      adjacency.set(from, list);
    };
    for (const edge of undirectedEdges) {
      addNeighbor(edge.from, edge.to);
      addNeighbor(edge.to, edge.from);
    }

    // Item counterpart of the group subtree sizing above: score every node the
    // whole network can reach from it, halved per hop. Edges are undirected in
    // practice, so raw reachability would tie all nodes in a component — the
    // decay is what lets hubs (e.g. "me" in the people graph) read as centers.
    const reachScore = new Map<string, number>();
    for (const itemId of visibleItemIds) {
      let score = 0;
      let hopWeight = 1;
      const visited = new Set<string>([itemId]);
      let frontier = adjacency.get(itemId) ?? [];
      while (frontier.length > 0) {
        const next: string[] = [];
        for (const neighborId of frontier) {
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);
          score += hopWeight;
          next.push(...(adjacency.get(neighborId) ?? []));
        }
        frontier = next;
        hopWeight /= 2;
      }
      reachScore.set(itemId, score);
    }

    const groupVal = (group: TGroup) => {
      const isRoot = !group.parentId;
      const subtree = subtreeMemberCount.get(group._id) ?? 0;
      const base = isRoot ? GROUP_ROOT_VAL_BASE : GROUP_CHILD_VAL_BASE;
      const perMember = isRoot
        ? GROUP_ROOT_VAL_PER_MEMBER
        : GROUP_CHILD_VAL_PER_MEMBER;
      return base + subtree * perMember;
    };

    const itemConnections = (item: TItem) =>
      (reachScore.get(item._id) ?? 0) + getItemGroupIds(item).length;

    // Group sizing treats items as groups whose members are their decayed
    // reach — but decayed reach can never out-count a big group's full-weight
    // subtree, so anchor the scale to the groups: the top-reach item is the
    // root of the whole graph ("I" in the people graph) and must land above
    // the largest group node. Leaves keep near-zero reach, so they stay small.
    let itemValPerConnectionInGroupMode = GROUP_ROOT_VAL_PER_MEMBER;
    if (itemSizing === "group") {
      const maxGroupVal = groups.reduce(
        (max, group) => Math.max(max, groupVal(group)),
        0,
      );
      const maxConnections = items.reduce(
        (max, item) => Math.max(max, itemConnections(item)),
        0,
      );
      if (maxConnections > 0) {
        const targetTopVal = Math.max(
          maxGroupVal * 1.35,
          GROUP_ROOT_VAL_BASE + maxConnections * GROUP_ROOT_VAL_PER_MEMBER,
        );
        itemValPerConnectionInGroupMode = Math.max(
          itemValPerConnectionInGroupMode,
          (targetTopVal - GROUP_CHILD_VAL_BASE) / maxConnections,
        );
      }
    }

    const nodes: KnowledgeGraphNodeData<TItem, TGroup>[] = [
      ...items.map((item) => {
        const connections = itemConnections(item);
        const val =
          itemSizing === "group"
            ? GROUP_CHILD_VAL_BASE +
              connections * itemValPerConnectionInGroupMode
            : itemValBase + connections * itemValPerConnection;
        return {
          id: item._id,
          label: getItemLabel(item),
          type: "item" as const,
          val,
          color: getItemColor(item, scheme),
          image: getItemImage?.(item),
          item,
        };
      }),
      ...groups.map((group) => ({
        id: `group:${group._id}`,
        label: group.name,
        type: "group" as const,
        val: groupVal(group),
        color: group.color ?? classColor(group.name, scheme),
        group,
      })),
    ];

    const links: KnowledgeGraphLinkData[] = [];

    for (const item of items) {
      for (const groupId of getItemGroupIds(item)) {
        if (groups.some((group) => group._id === groupId)) {
          links.push({
            source: item._id,
            target: `group:${groupId}`,
            type: "membership",
            strength: 1,
          });
        }
      }
    }

    for (const group of groups) {
      if (
        group.parentId &&
        groups.some((parent) => parent._id === group.parentId)
      ) {
        links.push({
          source: `group:${group._id}`,
          target: `group:${group.parentId}`,
          type: "membership",
          strength: 1,
        });
      }
    }

    for (const edge of undirectedEdges) {
      links.push({
        source: edge.from,
        target: edge.to,
        type: "relation",
        strength: edge.strength,
      });
    }

    return { nodes, links };
  }, [
    items,
    groups,
    edges,
    getItemLabel,
    getItemGroupIds,
    getItemColor,
    getItemImage,
    itemValBase,
    itemValPerConnection,
    itemSizing,
  ]);

  return (
    <KnowledgeGraph
      nodes={data.nodes}
      links={data.links}
      onSelectItem={onSelectItem}
      onSelectGroup={onSelectGroup}
      onItemContextMenu={onItemContextMenu}
      onGroupContextMenu={onGroupContextMenu}
      onBackgroundContextMenu={onBackgroundContextMenu}
      onRelationClick={(sourceId) => {
        const item = items.find((candidate) => candidate._id === sourceId);
        if (item) onSelectItem(item);
      }}
    />
  );
}
