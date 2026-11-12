import {
  type KnowledgeSpaceResponse,
  knowledgeSpaceResponseSchema,
} from "@repo/schemas";
import type { AdminClient, AdminRequestOptions } from "../client";

function spaceEndpoint(notebookId?: string): string {
  return notebookId
    ? `knowledge/space?notebookId=${encodeURIComponent(notebookId)}`
    : "knowledge/space";
}

export async function getKnowledgeSpace(
  client: AdminClient,
  notebookId?: string,
  options?: AdminRequestOptions,
): Promise<KnowledgeSpaceResponse> {
  const raw = await client.get<object>(spaceEndpoint(notebookId), options);
  return knowledgeSpaceResponseSchema.parse(raw);
}

export async function recomputeKnowledgeSpace(
  client: AdminClient,
  notebookId?: string,
): Promise<void> {
  await client.post<object>(
    "knowledge/space",
    notebookId ? { notebookId } : {},
  );
}
