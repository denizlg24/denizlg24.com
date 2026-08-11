"use client";

import {
  type DiscoveredField,
  type FieldMapping,
  fieldMappingSchema,
  type SafeProjectCollection,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { JsonEditor, useJsonDraft } from "@repo/ui/json-editor";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

const TEMPLATES = [
  {
    label: "all keys",
    value: {
      includeFields: [],
      excludeFields: [],
      searchableAttributes: [],
      filterableAttributes: [],
      sortableAttributes: [],
      primaryKey: "id",
    },
  },
  { label: "clear", value: {} },
] as const;

export function FieldMappingDialog({
  projectId,
  collection,
  onClose,
  onSaved,
}: {
  projectId: string;
  collection: SafeProjectCollection | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const draft = useJsonDraft<FieldMapping>(fieldMappingSchema, {});
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [fields, setFields] = useState<DiscoveredField[] | null>(null);
  const [busy, setBusy] = useState(false);

  const collectionRef = useRef<string | null>(null);
  if (collection && initializedFor !== collection.id) {
    setInitializedFor(collection.id);
    draft.reset(collection.fieldMapping);
    setFields(null);
  }
  collectionRef.current = collection?.id ?? null;

  const discover = async () => {
    if (!collection) return;
    try {
      const input =
        collection.sourceType === "mongodb"
          ? {
              sourceType: "mongodb" as const,
              mongoDatabase: collection.mongoDatabase ?? "",
              mongoCollection: collection.mongoCollection ?? "",
            }
          : {
              sourceType: "postgres" as const,
              pgDatabase: collection.pgDatabase ?? "",
              pgSchema: collection.pgSchema ?? "",
              pgTable: collection.pgTable ?? "",
            };
      const requestedFor = collection.id;
      const result = await api.projects.collections.discoverFields(
        projectId,
        input,
      );
      // The dialog can be switched to another collection mid-request; showing
      // the previous collection's fields under the new one is worse than none.
      if (requestedFor !== collectionRef.current) return;
      setFields(result.fields);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const save = async () => {
    if (!collection || !draft.result.ok) return;
    setBusy(true);
    try {
      await api.projects.collections.update(projectId, collection.id, {
        fieldMapping: draft.result.data,
      });
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={collection !== null}
      onOpenChange={(next) => {
        if (!next) {
          setInitializedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Field mapping — {collection?.name}</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <JsonEditor
            id="field-mapping-json"
            draft={draft}
            rows={16}
            templates={TEMPLATES}
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void discover()}>
              Discover fields
            </Button>
            <Button
              size="sm"
              disabled={busy || !draft.result.ok}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
          {fields && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-t pt-3 font-mono text-[11px] text-muted-foreground">
              {fields.map((field) => (
                <span key={field.name} className="truncate">
                  {field.name}
                  <span className="opacity-60"> {field.types.join("|")}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
