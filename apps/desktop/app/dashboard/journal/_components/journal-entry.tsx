"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { useTextareaEditor } from "@repo/ui/hooks/use-textarea-editor";
import { List, ListRow } from "@repo/ui/list";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { PageBody, PageTitle } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
import { Textarea } from "@repo/ui/textarea";
import { format } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  Eye,
  FileText,
  Loader2,
  Pencil,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import type { ICalendarEvent, IJournalLog } from "@/lib/data-types";
import { WhiteboardViewer } from "./whiteboard-viewer";

interface JournalEntryProps {
  journal: IJournalLog;
  date: Date;
  onBack: () => void;
  API: denizApi | null;
  onJournalUpdate: (journal: IJournalLog) => void;
}

const STATUS_VARIANT = {
  completed: "good",
  canceled: "critical",
} as const;

export function JournalEntry({
  journal,
  date,
  onBack,
  API,
  onJournalUpdate,
}: JournalEntryProps) {
  const [editing, setEditing] = useState(() => !journal.content.trim());
  const [content, setContent] = useState(journal.content);
  const [saving, setSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { onKeyDown } = useTextareaEditor(textareaRef, content, setContent);

  const isDirty = content !== journal.content;

  const handleSave = useCallback(async () => {
    if (!API) return;
    setSaving(true);
    const result = await API.PATCH<{ journal: IJournalLog }>({
      endpoint: `journal/${journal._id}`,
      body: { content },
    });
    setSaving(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    onJournalUpdate(result.journal);
    setEditing(false);
    toast.success("Saved");
  }, [API, journal._id, content, onJournalUpdate]);

  return (
    <PageBody width="narrow">
      <PageTitle
        title={format(date, "EEEE, MMMM d")}
        meta={<span className="tabular-nums">{format(date, "yyyy")}</span>}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back"
              className="md:hidden"
              onClick={onBack}
            >
              <ArrowLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={editing ? "Preview" : "Edit"}
              onClick={() => setEditing((prev) => !prev)}
            >
              {editing ? <Eye /> : <Pencil />}
            </Button>
            {editing || isDirty ? (
              <Button
                size="sm"
                disabled={!isDirty || saving}
                onClick={() => void handleSave()}
              >
                {saving ? <Loader2 className="animate-spin" /> : null}
                Save
              </Button>
            ) : null}
          </>
        }
      />

      {editing ? (
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              if (isDirty && !saving) void handleSave();
              return;
            }
            onKeyDown(event);
          }}
          aria-label="Entry"
          className="min-h-[50vh] resize-none border-none bg-transparent px-0 font-mono text-sm shadow-none focus-visible:ring-0"
        />
      ) : content.trim() ? (
        <MarkdownRenderer content={content} />
      ) : (
        <EmptyState compact label="Empty" />
      )}

      {journal.events.length > 0 ? (
        <Section title="Events" count={journal.events.length}>
          <List>
            {journal.events.map((event) => (
              <EventRow key={event._id} event={event} />
            ))}
          </List>
        </Section>
      ) : null}

      {journal.whiteboard ? (
        <Section title="Whiteboard">
          <div className="h-80 overflow-hidden rounded-md bg-surface/40">
            <WhiteboardViewer whiteboard={journal.whiteboard} />
          </div>
        </Section>
      ) : null}

      {journal.notes.length > 0 ? (
        <Section title="Notes" count={journal.notes.length}>
          <List>
            {journal.notes.map((noteId) => (
              <Link key={noteId} href={`/dashboard/notes?note=${noteId}`}>
                <ListRow
                  leading={<FileText />}
                  title={
                    <span className="font-mono text-xs">
                      {noteId.slice(-6)}
                    </span>
                  }
                />
              </Link>
            ))}
          </List>
        </Section>
      ) : null}
    </PageBody>
  );
}

function EventRow({ event }: { event: ICalendarEvent }) {
  const variant =
    event.status === "completed" || event.status === "canceled"
      ? STATUS_VARIANT[event.status]
      : "secondary";
  return (
    <ListRow
      leading={<Calendar />}
      title={event.title}
      description={event.place || undefined}
      meta={
        <>
          <span>{format(new Date(event.date), "p")}</span>
          <Badge variant={variant}>{event.status}</Badge>
        </>
      }
    />
  );
}
