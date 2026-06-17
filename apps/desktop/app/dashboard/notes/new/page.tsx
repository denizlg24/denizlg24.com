"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { INote, INoteEdge, INoteGroup } from "@/lib/data-types";
import { classifyNoteLocally } from "@/lib/semantic/classify-note";
import { NoteDetail } from "../_components/note-detail";

function createDraftNote(groupIds: string[]): INote {
  const now = new Date().toISOString();
  return {
    _id: "draft",
    title: "",
    content: "",
    tags: [],
    groupIds,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
}

export default function NewNotePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [draftNote, setDraftNote] = useState<INote>(() => {
    const group = searchParams.get("group");
    return createDraftNote(group ? [group] : []);
  });
  const [groups, setGroups] = useState<INoteGroup[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;

    Promise.all([
      api.GET<{ groups: INoteGroup[] }>({ endpoint: "note-groups" }),
      api.GET<{ tags: string[] }>({ endpoint: "notes/tags" }),
    ]).then(([groupResult, tagsResult]) => {
      if (!("code" in groupResult)) {
        setGroups(groupResult.groups);
      }

      if (!("code" in tagsResult)) {
        setSuggestions(tagsResult.tags);
      }
    });
  }, [api]);

  const handleDraftPatch = useCallback(
    async (body: Record<string, unknown>) => {
      if (savedNoteId && api) {
        const result = await api.PATCH<{ note: INote }>({
          endpoint: `notes/${savedNoteId}`,
          body,
        });
        if ("code" in result) {
          toast.error(result.message);
          return null;
        }
        setDraftNote(result.note);
        return result.note;
      }

      let nextNote: INote | null = null;

      setDraftNote((current) => {
        const next: INote = {
          ...current,
          updatedAt: new Date().toISOString(),
        };

        if (typeof body.title === "string") next.title = body.title;
        if (typeof body.content === "string") next.content = body.content;
        if (typeof body.description === "string")
          next.description = body.description;
        if (typeof body.class === "string") {
          next.class = body.class.trim().length > 0 ? body.class : undefined;
        }
        if (Array.isArray(body.tags)) {
          next.tags = body.tags.filter(
            (tag): tag is string => typeof tag === "string",
          );
        }
        if (Array.isArray(body.groupIds)) {
          next.groupIds = body.groupIds.filter(
            (groupId): groupId is string => typeof groupId === "string",
          );
        }
        if (body.status === "open" || body.status === "archived") {
          next.status = body.status;
        }
        if (body.publishedDate === null) {
          next.publishedDate = undefined;
        } else if (typeof body.publishedDate === "string") {
          next.publishedDate = body.publishedDate;
        }

        nextNote = next;
        return next;
      });

      return nextNote;
    },
    [api, savedNoteId],
  );

  const handleCreateNote = useCallback(
    async (content: string) => {
      if (!api || submitting) return;

      const title = draftNote.title.trim();
      if (!title) {
        toast.error("Title is required");
        return;
      }

      setSubmitting(true);

      const result = await api.POST<{
        note: INote;
        groups: INoteGroup[];
        edges: INoteEdge[];
      }>({
        endpoint: "notes",
        body: {
          title,
          content,
          class: draftNote.class,
          tags: draftNote.tags,
          groupIds: draftNote.groupIds,
          status: draftNote.status,
          publishedDate: draftNote.publishedDate,
          skipCategorize: true,
        },
      });

      setSubmitting(false);

      if ("code" in result) {
        toast.error(result.message);
        return;
      }

      setSavedNoteId(result.note._id);
      setDraftNote(result.note);
      setGroups(result.groups);

      try {
        const classified = await classifyNoteLocally({
          api,
          note: result.note,
          groups: result.groups,
        });
        setDraftNote(classified.note);
        setGroups(classified.groups);
        toast.success("Note created and classified");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? `Note created, local classification failed: ${error.message}`
            : "Note created, local classification failed",
        );
      }
    },
    [api, draftNote, groups, submitting],
  );

  const handleDelete = useCallback(async () => {
    if (!savedNoteId || !api) {
      router.push("/dashboard/notes");
      return;
    }
    const result = await api.DELETE<{ success: true }>({
      endpoint: `notes/${savedNoteId}`,
    });
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    toast.success("Note deleted");
    router.push("/dashboard/notes");
  }, [api, router, savedNoteId]);

  const isSaved = savedNoteId !== null;

  return (
    <NoteDetail
      note={draftNote}
      allNotes={isSaved ? [draftNote] : []}
      groups={groups}
      edges={[]}
      suggestions={suggestions}
      onPatch={handleDraftPatch}
      onDelete={handleDelete}
      onBack={() => router.push("/dashboard/notes")}
      onSelectNote={() => {}}
      onSuggestionsChange={setSuggestions}
      onUpdated={(note) => setDraftNote(note)}
      api={isSaved ? api : null}
      mode={isSaved ? "existing" : "draft"}
      onSaveDraft={handleCreateNote}
      savingDraft={submitting}
    />
  );
}
