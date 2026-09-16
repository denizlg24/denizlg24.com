"use client";

import type {
  IVoiceNoteSummary,
  VoiceNoteContextCandidate,
  VoiceNoteContextCandidatesResponse,
  VoiceNoteUpdateInput,
} from "@repo/schemas";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@repo/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Check, ChevronDown, Loader2, Pin } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatSpan, formatTimeRange } from "@/components/voice-notes/format";
import type { denizApi } from "@/lib/api-wrapper";
import { cn } from "@/lib/utils";
import { ContextDot } from "./voice-notes-primitives";

type ContextChoice = NonNullable<VoiceNoteUpdateInput["context"]> | null;

function matchContext(_value: string, search: string, keywords?: string[]) {
  const haystack = (keywords ?? []).join(" ").toLowerCase();
  return haystack.includes(search.trim().toLowerCase()) ? 1 : 0;
}

function CandidateItem({
  candidate,
  current,
  onSelect,
}: {
  candidate: VoiceNoteContextCandidate;
  current: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={`${candidate.kind}:${candidate.id}`}
      keywords={[candidate.title, candidate.place ?? ""]}
      onSelect={onSelect}
      className="items-start text-xs"
    >
      <Check
        className={cn("mt-0.5 size-3.5", current ? "opacity-100" : "opacity-0")}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <ContextDot color={candidate.color} />
          <span className="truncate">{candidate.title}</span>
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatTimeRange(candidate.start, candidate.end)}
          {candidate.place && ` · ${candidate.place}`}
        </span>
      </div>
      <span
        className={cn(
          "shrink-0 font-mono text-[10px] tabular-nums",
          candidate.overlapMs > 0
            ? "text-foreground"
            : "text-muted-foreground/60",
        )}
      >
        {candidate.overlapMs > 0 ? formatSpan(candidate.overlapMs) : "—"}
      </span>
    </CommandItem>
  );
}

export function VoiceNoteContextPicker({
  api,
  voiceNote,
  disabled,
  onChoose,
}: {
  api: denizApi;
  voiceNote: IVoiceNoteSummary;
  disabled?: boolean;
  onChoose: (
    context: ContextChoice,
    candidate?: VoiceNoteContextCandidate,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] =
    useState<VoiceNoteContextCandidatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { context, contextSource } = voiceNote;
  const manual = contextSource === "manual";

  const loadCandidates = async () => {
    setLoading(true);
    const result = await api.GET<VoiceNoteContextCandidatesResponse>({
      endpoint: `voice-notes/${voiceNote._id}/context-candidates`,
    });
    setLoading(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    setCandidates(result);
  };

  const choose = async (
    choice: ContextChoice,
    candidate?: VoiceNoteContextCandidate,
  ) => {
    setOpen(false);
    setSaving(true);
    await onChoose(choice, candidate);
    setSaving(false);
  };

  const isCurrent = (candidate: VoiceNoteContextCandidate) =>
    context?.kind === candidate.kind && context.id === candidate.id;

  const range = formatTimeRange(context?.start, context?.end);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !candidates && !loading) void loadCandidates();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || saving}
          className="-mx-1.5 flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-muted/60"
        >
          {context ? (
            <>
              <ContextDot color={context.color} />
              <span className="truncate">{context.title}</span>
              {range && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {range}
                </span>
              )}
              {context.place && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {context.place}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {manual && (
            <Pin
              className="size-2.5 shrink-0 text-muted-foreground/70"
              aria-label="Set manually"
            />
          )}
          {saving ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/60" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command filter={matchContext}>
          <CommandInput className="h-8 text-xs" placeholder="Context" />
          <CommandList className="max-h-80">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              —
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="auto"
                keywords={["auto"]}
                onSelect={() => void choose("auto")}
                className="text-xs"
              >
                <Check
                  className={cn(
                    "size-3.5",
                    manual ? "opacity-0" : "opacity-100",
                  )}
                />
                Auto
              </CommandItem>
              <CommandItem
                value="none"
                keywords={["none"]}
                onSelect={() => void choose(null)}
                className="text-xs"
              >
                <Check
                  className={cn(
                    "size-3.5",
                    manual && !context ? "opacity-100" : "opacity-0",
                  )}
                />
                None
              </CommandItem>
            </CommandGroup>
            {loading && (
              <div className="flex justify-center py-3">
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              </div>
            )}
            {candidates && candidates.events.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Events">
                  {candidates.events.map((candidate) => (
                    <CandidateItem
                      key={`${candidate.kind}:${candidate.id}`}
                      candidate={candidate}
                      current={isCurrent(candidate)}
                      onSelect={() =>
                        void choose(
                          { kind: candidate.kind, id: candidate.id },
                          candidate,
                        )
                      }
                    />
                  ))}
                </CommandGroup>
              </>
            )}
            {candidates && candidates.timetableEntries.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Timetable">
                  {candidates.timetableEntries.map((candidate) => (
                    <CandidateItem
                      key={`${candidate.kind}:${candidate.id}`}
                      candidate={candidate}
                      current={isCurrent(candidate)}
                      onSelect={() =>
                        void choose(
                          { kind: candidate.kind, id: candidate.id },
                          candidate,
                        )
                      }
                    />
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export type { ContextChoice };
