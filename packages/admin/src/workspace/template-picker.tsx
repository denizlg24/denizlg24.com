"use client";

import {
  type TemplateInputs,
  type WorkspaceTemplateSummary,
  workspaceTemplateSummarySchema,
} from "@repo/schemas";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { LayoutTemplate } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import { create } from "zustand";
import type { AdminClient } from "../client";
import { useAdmin } from "../provider";
import { PageIcon } from "./page-icon";

/*
 * One dialog for both uses of a template: a new page (the sidebar's new-page
 * menu) or blocks inserted into the page being edited (the "/" menu). Whoever
 * opens it passes what to do with the pick; the dialog asks for the
 * template's inputs, if it has any, and hands them over.
 */

export type TemplateUse = "page" | "insert";

interface TemplateRequest {
  use: TemplateUse;
  onPick: (templateId: string, inputs: TemplateInputs) => Promise<void>;
}

export const useTemplatePicker = create<{
  request: TemplateRequest | null;
  /** Mounted pickers per use; only the first renders, so a request opens one dialog. */
  owners: Record<TemplateUse, string[]>;
  open: (request: TemplateRequest) => void;
  close: () => void;
  claim: (use: TemplateUse, id: string) => void;
  release: (use: TemplateUse, id: string) => void;
}>((set) => ({
  request: null,
  owners: { page: [], insert: [] },
  open: (request) => set({ request }),
  close: () => set({ request: null }),
  claim: (use, id) =>
    set((s) => ({
      owners: { ...s.owners, [use]: [...s.owners[use], id] },
    })),
  release: (use, id) =>
    set((s) => ({
      owners: { ...s.owners, [use]: s.owners[use].filter((o) => o !== id) },
    })),
}));

const templatesSchema = z.object({
  templates: z.array(workspaceTemplateSummarySchema),
});

export async function fetchTemplates(
  client: AdminClient,
): Promise<WorkspaceTemplateSummary[]> {
  return templatesSchema.parse(await client.get("workspace/templates"))
    .templates;
}

/** Renders the dialog for requests of one use; mount each use once. */
export function TemplatePicker({ use }: { use: TemplateUse }) {
  const id = useId();
  const claim = useTemplatePicker((s) => s.claim);
  const release = useTemplatePicker((s) => s.release);
  const owner = useTemplatePicker((s) => s.owners[use][0] === id);
  useEffect(() => {
    claim(use, id);
    return () => release(use, id);
  }, [claim, release, use, id]);
  return owner ? <PickerDialog use={use} /> : null;
}

function PickerDialog({ use }: { use: TemplateUse }) {
  const request = useTemplatePicker((s) =>
    s.request?.use === use ? s.request : null,
  );
  const close = useTemplatePicker((s) => s.close);
  const { client } = useAdmin();
  const [templates, setTemplates] = useState<WorkspaceTemplateSummary[] | null>(
    null,
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [inputs, setInputs] = useState<TemplateInputs>({});
  const [pending, setPending] = useState(false);
  const open = request !== null;

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setInputs({});
    setTemplates(null);
    let live = true;
    fetchTemplates(client)
      .then((list) => {
        if (!live) return;
        setTemplates(list);
        if (list.length === 1) setPicked(list[0]?.id ?? null);
      })
      .catch(() => live && setTemplates([]));
    return () => {
      live = false;
    };
  }, [open, client]);

  const template = templates?.find((t) => t.id === picked) ?? null;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Templates"
      submitLabel={use === "page" ? "Create" : "Insert"}
      submitDisabled={!template}
      pending={pending}
      onSubmit={async () => {
        if (!request || !template) return;
        setPending(true);
        try {
          await request.onPick(template.id, inputs);
          close();
        } finally {
          setPending(false);
        }
      }}
    >
      {templates === null ? null : templates.length === 0 ? (
        <EmptyState compact icon={<LayoutTemplate />} label="No templates" />
      ) : (
        <List>
          {templates.map((t) => (
            <ListRow
              key={t.id}
              selected={t.id === picked}
              onClick={() => setPicked(t.id)}
              leading={<PageIcon icon={t.icon} />}
              title={t.title || "Untitled"}
              meta={t.inputs.length > 0 ? t.inputs.join(", ") : null}
            />
          ))}
        </List>
      )}
      {template && template.inputs.length > 0 ? (
        <FormGrid>
          {template.inputs.map((name) => (
            <FormField key={name} label={name} htmlFor={`input-${name}`}>
              <Input
                id={`input-${name}`}
                value={inputs[name] ?? ""}
                onChange={(event) =>
                  setInputs((current) => ({
                    ...current,
                    [name]: event.target.value,
                  }))
                }
              />
            </FormField>
          ))}
        </FormGrid>
      ) : null}
    </FormDialog>
  );
}
