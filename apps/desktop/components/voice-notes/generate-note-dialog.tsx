"use client";

import type { INote, IVoiceNote } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Label } from "@repo/ui/label";
import { Separator } from "@repo/ui/separator";
import { Textarea } from "@repo/ui/textarea";
import { FilePlus2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ModelSelector } from "@/components/ui/model-selector";
import { pickDefaultModel, useModelCatalog } from "@/hooks/use-model-catalog";
import type { denizApi } from "@/lib/api-wrapper";

const MAX_INSTRUCTIONS_CHARS = 2_000;

interface GenerateNoteDialogProps {
  api: denizApi;
  voiceNote: IVoiceNote;
  onChanged?: (voiceNote: IVoiceNote) => void;
  onGenerated?: (note: INote) => void;
}

/**
 * Split from the trigger so the model catalog is only fetched once the dialog
 * is actually opened — a page of voice notes would otherwise request it once
 * per card on mount.
 */
function GenerateNoteForm({
  api,
  voiceNote,
  onChanged,
  onGenerated,
  onDone,
}: GenerateNoteDialogProps & { onDone: () => void }) {
  const modelCatalog = useModelCatalog(api);
  const [model, setModel] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (model || !modelCatalog.models?.length) return;
    const defaultModel = pickDefaultModel(modelCatalog.models, []);
    if (defaultModel) setModel(defaultModel);
  }, [model, modelCatalog.models]);

  const generate = async () => {
    setGenerating(true);
    const result = await api.POST<{ note: INote; voiceNote: IVoiceNote }>({
      endpoint: `voice-notes/${voiceNote._id}/generate-note`,
      body: {
        ...(model ? { model } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      },
    });
    setGenerating(false);
    if ("code" in result) {
      toast.error(result.message);
      return;
    }
    onChanged?.(result.voiceNote);
    onGenerated?.(result.note);
    onDone();
    toast.success("Note generated");
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate">{voiceNote.title}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-start gap-1">
          <Label htmlFor="generate-note-model" className="w-32">
            Model
          </Label>
          <ModelSelector
            model={model}
            onModelChange={setModel}
            models={modelCatalog.models}
            loading={modelCatalog.loading}
            error={modelCatalog.error}
            stale={modelCatalog.stale}
            onRetry={modelCatalog.retry}
          />
        </div>
        <Separator />
        <div className="flex flex-col items-start gap-1">
          <Label htmlFor="generate-note-instructions" className="w-32">
            Instructions
          </Label>
          <Textarea
            id="generate-note-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            maxLength={MAX_INSTRUCTIONS_CHARS}
            className="h-24 resize-none overflow-y-auto rounded-none font-mono text-sm"
          />
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={generating}>
            Cancel
          </Button>
        </DialogClose>
        <Button onClick={() => void generate()} disabled={generating || !model}>
          {generating ? (
            <>
              Generating <Loader2 className="animate-spin" />
            </>
          ) : (
            "Create note"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

export function GenerateNoteDialog(props: GenerateNoteDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[10px]"
        >
          <FilePlus2 className="size-3" />
          Note
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <GenerateNoteForm {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
