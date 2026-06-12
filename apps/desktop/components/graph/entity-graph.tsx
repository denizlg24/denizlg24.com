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
  itemValBase?: number;
  itemValPerConnection?: number;
  onSelectItem: (item: TItem) => void;
  onSelectGroup: (group: TGroup) => void;
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
  itemValBase = 0.75,
  itemValPerConnection = 0.28,
  onSelectItem,
  onSelectGroup,
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

    const edgeCount = new Map<string, number>();
    for (const edge of undirectedEdges) {
      edgeCount.set(edge.from, (edgeCount.get(edge.from) ?? 0) + 1);
      edgeCount.set(edge.to, (edgeCount.get(edge.to) ?? 0) + 1);
    }

    const nodes: KnowledgeGraphNodeData<TItem, TGroup>[] = [
      ...items.map((item) => {
        const connections =
          (edgeCount.get(item._id) ?? 0) + getItemGroupIds(item).length;
        return {
          id: item._id,
          label: getItemLabel(item),
          type: "item" as const,
          val: itemValBase + connections * itemValPerConnection,
          color: getItemColor(item, scheme),
          item,
        };
      }),
      ...groups.map((group) => {
        const isRoot = !group.parentId;
        const subtree = subtreeMemberCount.get(group._id) ?? 0;
        const base = isRoot ? 14 : 5;
        const perMember = isRoot ? 2.2 : 1.2;
        return {
          id: `group:${group._id}`,
          label: group.name,
          type: "group" as const,
          val: base + subtree * perMember,
          color: group.color ?? classColor(group.name, scheme),
          group,
        };
      }),
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
    itemValBase,
    itemValPerConnection,
  ]);

  return (
    <KnowledgeGraph
      nodes={data.nodes}
      links={data.links}
      onSelectItem={onSelectItem}
      onSelectGroup={onSelectGroup}
      onRelationClick={(sourceId) => {
        const item = items.find((candidate) => candidate._id === sourceId);
        if (item) onSelectItem(item);
      }}
    />
  );
}
