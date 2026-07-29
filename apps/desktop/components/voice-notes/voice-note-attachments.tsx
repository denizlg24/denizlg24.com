"use client";

import type { INote, IVoiceNote, VoiceNotesResponse } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Check, ChevronsUpDown, Loader2, Mic } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import { VoiceNoteBar } from "./voice-note-bar";

interface VoiceNoteAttachmentsProps {
  api: denizApi;
  note: INote;
  onPatch: (body: Record<string, unknown>) => Promise<INote | null>;
}

export function VoiceNoteAttachments({
  api,
  note,
  onPatch,
}: VoiceNoteAttachmentsProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voiceNotes, setVoiceNotes] = useState<IVoiceNote[]>([]);
  const selectedIds = note.voiceNoteIds ?? [];
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => voiceNotes.find((voiceNote) => voiceNote._id === id))
        .filter((voiceNote): voiceNote is IVoiceNote => Boolean(voiceNote)),
    [selectedIds, voiceNotes],
  );

  const load = useCallback(async () => {
    const result = await api.GET<VoiceNotesResponse>({
      endpoint: "voice-notes?limit=100",
    });
    setLoading(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    setVoiceNotes(result.voiceNotes);
  }, [api]);

  useEffect(() => {
    void load();
    const handleChanged = () => void load();
    window.addEventListener("voice-notes:changed", handleChanged);
    return () =>
      window.removeEventListener("voice-notes:changed", handleChanged);
  }, [load]);

  useEffect(() => {
    const hasPending = selected.some((voiceNote) =>
      ["queued", "transcribing"].includes(voiceNote.transcription.status),
    );
    if (!hasPending) return;
    const interval = setInterval(() => void load(), 5_000);
    return () => clearInterval(interval);
  }, [load, selected]);

  const commit = useCallback(
    async (next: string[]) => {
      setSaving(true);
      const updated = await onPatch({ voiceNoteIds: next });
      setSaving(false);
      if (updated) {
        window.dispatchEvent(new CustomEvent("voice-notes:changed"));
      }
    },
    [onPatch],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              disabled={loading || saving}
              aria-expanded={open}
            >
              {loading || saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Mic className="size-3" />
              )}
              Attach
              <ChevronsUpDown className="size-3 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search voice notes…" />
              <CommandList>
                <CommandEmpty>No voice notes found</CommandEmpty>
                <CommandGroup>
                  {voiceNotes.map((voiceNote) => (
                    <CommandItem
                      key={voiceNote._id}
                      value={`${voiceNote.title} ${voiceNote.transcription.text ?? ""}`}
                      onSelect={() => {
                        const next = selectedIdSet.has(voiceNote._id)
                          ? selectedIds.filter((id) => id !== voiceNote._id)
                          : [...selectedIds, voiceNote._id];
                        setOpen(false);
                        void commit(next);
                      }}
                    >
                      <Check
                        className={`size-3.5 ${selectedIdSet.has(voiceNote._id) ? "opacity-100" : "opacity-0"}`}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs">{voiceNote.title}</p>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {voiceNote.transcription.status}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {selected.map((voiceNote) => (
        <VoiceNoteBar
          key={voiceNote._id}
          api={api}
          voiceNote={voiceNote}
          onDetach={() =>
            void commit(selectedIds.filter((id) => id !== voiceNote._id))
          }
        />
      ))}
    </div>
  );
}
