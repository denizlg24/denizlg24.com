import type { denizApi } from "@/lib/api-wrapper";
import type { INote, INoteGroup } from "@/lib/data-types";

interface ClassifyNoteResponse {
  note: INote;
  groups: INoteGroup[];
  classification: {
    model: string;
    keywords: string[];
    summary: string;
    assignedGroupIds: string[];
    suggestedGroupIds: string[];
    suggestedTags: string[];
    appliedTags: string[];
    mode: "applied" | "suggested";
  };
}

function isApiError<T>(value: T | { code: number; message: string }): value is {
  code: number;
  message: string;
} {
  return Boolean(value && typeof value === "object" && "code" in value);
}

export async function classifyNoteLocally({
  api,
  note,
  signal,
}: {
  api: denizApi;
  note: INote;
  groups?: INoteGroup[];
  signal?: AbortSignal;
}) {
  if (signal?.aborted) throw new Error("Aborted");

  const result = await api.POST<ClassifyNoteResponse>({
    endpoint: `semantic/notes/${note._id}/classify`,
    body: {},
  });

  if (signal?.aborted) throw new Error("Aborted");

  if (isApiError(result)) {
    throw new Error(result.message);
  }

  return result;
}
