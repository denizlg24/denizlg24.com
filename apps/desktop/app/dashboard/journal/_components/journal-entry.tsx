"use client";

import { format } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Edit2,
  Eye,
  FileText,
  Loader2,
  MapPin,
  PenTool,
  Save,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useTextareaEditor } from "@/hooks/use-textarea-editor";
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

export function JournalEntry({
  journal,
  date,
  onBack,
  API,
  onJournalUpdate,
}: JournalEntryProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(journal.content);
  const [saving, setSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { onKeyDown } = useTextareaEditor(textareaRef, content, setContent);

  const handleSave = useCallback(async () => {
    if (!API) return;
    setSaving(true);
    try {
      const result = await API.PATCH<{ journal: IJournalLog }>({
        endpoint: `journal/${journal._id}`,
        body: { content },
      });
      if (!("code" in result)) {
        onJournalUpdate(result.journal);
        setEditing(false);
        toast.success("Saved");
      }
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [API, journal._id, content, onJournalUpdate]);

  const isDirty = content !== journal.content;
  const hasEvents = journal.events.length > 0;
  const hasNotes = journal.notes.length > 0;
  const hasWhiteboard = !!journal.whiteboard;
  const hasAppendix = hasEvents || hasNotes || hasWhiteboard;

  return (
    <div className="flex flex-col h-full w-full max-w-2xl mx-auto">
      <div className="flex items-center gap-3 py-3 shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-calistoga lowercase tracking-tight text-foreground truncate">
            {format(date, "EEEE, MMMM d")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {format(date, "yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setEditing((prev) => !prev)}
          >
            {editing ? (
              <Eye className="size-4" />
            ) : (
              <Edit2 className="size-4" />
            )}
          </Button>
          {editing && (
            <Button
              size="icon"
              disabled={!isDirty || saving}
              onClick={handleSave}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      <Separator />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {editing ? (
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={onKeyDown}
            className="font-mono text-sm w-full h-full min-h-75 rounded-none border-none! outline-none! ring-0! shadow-none! resize-none! py-4"
          />
        ) : (
          <div className="py-4 px-1">
            {content.trim() ? (
              <MarkdownRenderer content={content} />
            ) : (
              <p className="text-sm text-muted-foreground/50 italic">
                Nothing written yet. Click the edit button to start writing.
              </p>
            )}
          </div>
        )}

        {hasAppendix && (
          <div className="mt-6 space-y-6 pb-6">
            <Separator />

            {hasEvents && (
              <section className="space-y-3 px-1">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground/60">
                  <Calendar className="size-3" />
                  <span>Events</span>
                </div>
                <div className="space-y-2">
                  {journal.events.map((event) => (
                    <EventRow key={event._id} event={event} />
                  ))}
                </div>
              </section>
            )}

            {hasWhiteboard && journal.whiteboard && (
              <section className="space-y-3 px-1">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground/60">
                  <PenTool className="size-3" />
                  <span>Whiteboard</span>
                </div>
                <div className="rounded-lg border border-border/60 overflow-hidden h-80">
                  <WhiteboardViewer whiteboard={journal.whiteboard} />
                </div>
              </section>
            )}

            {hasNotes && (
              <section className="space-y-3 px-1">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground/60">
                  <FileText className="size-3" />
                  <span>Notes</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {journal.notes.map((noteId) => (
                    <Badge
                      key={noteId}
                      variant="secondary"
                      className="text-xs font-mono cursor-pointer hover:bg-accent transition-colors"
                      onClick={() =>
                        router.push(`/dashboard/notes?note=${noteId}`)
                      }
                    >
                      {noteId.slice(-6)}
                    </Badge>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: ICalendarEvent }) {
  const eventDate = new Date(event.date);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-surface/50 px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">
            {event.title}
          </p>
          <Badge
            variant={
              event.status === "completed"
                ? "default"
                : event.status === "canceled"
                  ? "destructive"
                  : "secondary"
            }
            className="text-[10px] shrink-0"
          >
            {event.status}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {format(eventDate, "p")}
          </span>
          {event.place && (
            <span className="flex items-center gap-1 truncate">
              <MapPin className="size-3" />
              {event.place}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
