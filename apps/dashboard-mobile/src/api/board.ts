import type {
  IWhiteboard,
  WhiteboardComponentItemOps,
  WhiteboardElementPatch,
  WhiteboardNewElement,
} from "@repo/schemas";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { bytesToBase64 } from "@/lib/base64";
import { todayKey } from "./today";

export const boardKey = ["board"] as const;

export function useBoard() {
  return useQuery({
    queryKey: boardKey,
    queryFn: async () =>
      (await api.request<{ whiteboard: IWhiteboard }>("whiteboard/today"))
        .whiteboard,
  });
}

export interface BoardPicture {
  uri: string;
  width: number;
  height: number;
}

/** The server's resvg render; null for an empty board. */
export function useBoardPicture(version: string | undefined) {
  return useQuery({
    queryKey: [...boardKey, "picture", version],
    enabled: version !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<BoardPicture | null> => {
      const response = await api.raw("whiteboard/today/render");
      if (response.headers.get("content-type")?.includes("json")) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        uri: `data:image/png;base64,${bytesToBase64(bytes)}`,
        width: Number(response.headers.get("x-image-width")) || 1,
        height: Number(response.headers.get("x-image-height")) || 1,
      };
    },
  });
}

function refreshBoard(client: QueryClient) {
  void client.invalidateQueries({ queryKey: boardKey });
  void client.invalidateQueries({ queryKey: todayKey });
}

/** Applies item ops locally first, so a tick lands before the round trip. */
function optimisticItems(
  board: IWhiteboard,
  elementId: string,
  ops: WhiteboardComponentItemOps,
): IWhiteboard {
  return {
    ...board,
    elements: board.elements.map((element) => {
      if (element.id !== elementId) return element;
      const key = element.componentType === "quick-links" ? "links" : "items";
      const rows = Array.isArray(element.data[key])
        ? (element.data[key] as Record<string, unknown>[])
        : [];
      const removed = new Set(ops.remove ?? []);
      let next = rows
        .filter((row) => !removed.has(String(row.id)))
        .map((row) => {
          const patch = ops.update?.find((entry) => entry.id === row.id);
          return patch ? { ...row, ...patch } : row;
        });
      if (ops.add?.length) {
        const at = Math.min(ops.insertAt ?? next.length, next.length);
        const added = ops.add.map((row, index) => ({
          completed: false,
          ...row,
          id: `pending-${Date.now()}-${index}`,
        }));
        next = [...next.slice(0, at), ...added, ...next.slice(at)];
      }
      return { ...element, data: { ...element.data, [key]: next } };
    }),
  };
}

export function useBoardItems() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      elementId,
      ops,
    }: {
      elementId: string;
      ops: WhiteboardComponentItemOps;
    }) =>
      api.request(`whiteboard/today/elements/${elementId}/items`, {
        method: "PATCH",
        body: ops,
      }),
    onMutate: async ({ elementId, ops }) => {
      await client.cancelQueries({ queryKey: boardKey, exact: true });
      const previous = client.getQueryData<IWhiteboard>(boardKey);
      if (previous) {
        client.setQueryData(
          boardKey,
          optimisticItems(previous, elementId, ops),
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) client.setQueryData(boardKey, context.previous);
    },
    onSettled: () => refreshBoard(client),
  });
}

export function usePatchBoardElement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      elementId,
      patch,
    }: {
      elementId: string;
      patch: WhiteboardElementPatch;
    }) =>
      api.request(`whiteboard/today/elements/${elementId}`, {
        method: "PATCH",
        body: patch,
      }),
    onSettled: () => refreshBoard(client),
  });
}

export function useAddBoardElement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (element: WhiteboardNewElement) =>
      api.request<{ addedElementIds: string[] }>("whiteboard/today/elements", {
        method: "POST",
        body: { elements: [element] },
      }),
    onSettled: () => refreshBoard(client),
  });
}

export function useRemoveBoardElement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (elementId: string) =>
      api.request("whiteboard/today/elements", {
        method: "DELETE",
        body: { elementIds: [elementId] },
      }),
    onSettled: () => refreshBoard(client),
  });
}

/** Also files the day into the journal on the server. */
export function useClearDay() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.request("whiteboard/today", { method: "DELETE" }),
    onSettled: () => refreshBoard(client),
  });
}
