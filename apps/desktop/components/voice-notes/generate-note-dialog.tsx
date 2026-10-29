"use client";

import type { INote, IVoiceNote } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { ModelSelector } from "@repo/ui/model-selector";
import { Textarea } from "@repo/ui/textarea";
import { FilePlus2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
 * Mounted only while open so the model catalog is fetched on demand — a page
 * of voice notes would otherwise request it once per card on mount.
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
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title={voiceNote.title}
      submitLabel="Create note"
      submitDisabled={!model}
      pending={generating}
      onSubmit={generate}
    >
      <FormGrid>
        <FormField label="Model" className="sm:col-span-2">
          <ModelSelector
            model={model}
            onModelChange={setModel}
            models={modelCatalog.models}
            loading={modelCatalog.loading}
            error={modelCatalog.error}
            stale={modelCatalog.stale}
            onRetry={modelCatalog.retry}
          />
        </FormField>
        <FormField
          label="Instructions"
          htmlFor="generate-note-instructions"
          className="sm:col-span-2"
        >
          <Textarea
            id="generate-note-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            maxLength={MAX_INSTRUCTIONS_CHARS}
            className="min-h-48 resize-y text-sm"
          />
        </FormField>
      </FormGrid>
    </FormDialog>
  );
}

export function GenerateNoteDialog(props: GenerateNoteDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <FilePlus2 />
        Note
      </Button>
      {open && <GenerateNoteForm {...props} onDone={() => setOpen(false)} />}
    </>
  );
}
