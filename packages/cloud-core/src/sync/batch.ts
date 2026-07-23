export type IndexOperation =
  | {
      type: "upsert";
      id: string;
      document: Record<string, unknown>;
    }
  | {
      type: "delete";
      id: string;
    };

export function coalesceIndexOperations(operations: IndexOperation[]): {
  upserts: Record<string, unknown>[];
  deletes: string[];
} {
  const latestById = new Map<string, IndexOperation>();
  for (const operation of operations) {
    latestById.set(operation.id, operation);
  }

  const upserts: Record<string, unknown>[] = [];
  const deletes: string[] = [];
  for (const operation of latestById.values()) {
    if (operation.type === "upsert") {
      upserts.push(operation.document);
    } else {
      deletes.push(operation.id);
    }
  }
  return { upserts, deletes };
}
