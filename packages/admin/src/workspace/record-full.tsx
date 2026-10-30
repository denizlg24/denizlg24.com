"use client";

import {
  courseDetailSchema,
  type ICourseDetail,
  type INote,
  noteSchema,
} from "@repo/schemas";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback, useContext, useEffect, useState } from "react";
import { z } from "zod";
import { CourseWorkPanel } from "../courses/course-assignments";
import { FinanceEnvelopePage } from "../finance/finance-envelope-page";
import { NoteDetail } from "../notes/note-detail";
import { useAdmin } from "../provider";
import { FlowEditor } from "./editor/flow-editor";
import { FlowPageContext } from "./editor/node-views";
import type { RecordFullProps } from "./records";

/*
 * Full mode: the module's own component for one record, mounted in a page.
 * Each loads its record through the admin client the way its module page
 * does, and edits through the module's own routes.
 */

/** Pages nest at most two deep, like synced blocks; deeper shows nothing. */
export function PageFull({ id, editable }: RecordFullProps) {
  const { depth } = useContext(FlowPageContext);
  if (depth >= 2) return null;
  return (
    <div className="border-l-2 border-border pl-4">
      <FlowEditor pageId={id} editable={editable} depth={depth + 1} />
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2 py-1">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

const noteResponse = z.object({ note: noteSchema });

export function NoteFull({ id }: RecordFullProps) {
  const { client } = useAdmin();
  const [note, setNote] = useState<INote | null>(null);
  useEffect(() => {
    let live = true;
    client
      .get(`notes/${encodeURIComponent(id)}`)
      .then((body) => {
        if (live) setNote(noteResponse.parse(body).note);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client, id]);
  if (!note) return <Loading />;
  return (
    <NoteDetail
      note={note}
      allNotes={[note]}
      groups={[]}
      edges={[]}
      suggestions={[]}
      onPatch={async (body) => {
        const next = noteResponse.parse(
          await client.patch(`notes/${encodeURIComponent(id)}`, body),
        ).note;
        setNote(next);
        return next;
      }}
      onDelete={async () => {
        await client.del(`notes/${encodeURIComponent(id)}`);
        setNote(null);
      }}
      onBack={() => {}}
      onSelectNote={() => {}}
      onSuggestionsChange={() => {}}
      onUpdated={setNote}
    />
  );
}

const courseResponse = z.object({ detail: courseDetailSchema });

export function CourseFull({ id }: RecordFullProps) {
  const { client } = useAdmin();
  const [detail, setDetail] = useState<ICourseDetail | null>(null);
  const load = useCallback(async () => {
    setDetail(
      courseResponse.parse(
        await client.get(`courses/${encodeURIComponent(id)}`),
      ).detail,
    );
  }, [client, id]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  if (!detail) return <Loading />;
  return (
    <CourseWorkPanel
      courseId={id}
      assignments={detail.assignments}
      deadlines={detail.deadlines}
      kanbanCards={detail.kanbanCards}
      readings={detail.readings}
      onRefresh={load}
    />
  );
}

export function EnvelopeFull({ id }: RecordFullProps) {
  return <FinanceEnvelopePage envelopeId={id} />;
}
