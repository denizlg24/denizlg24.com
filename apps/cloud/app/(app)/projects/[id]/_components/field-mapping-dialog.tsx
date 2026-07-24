"use client";

import type {
  DiscoveredField,
  FieldMapping,
  SafeProjectCollection,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Textarea } from "@repo/ui/textarea";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

function toText(values: string[] | undefined): string {
  return (values ?? []).join(", ");
}

function toList(text: string): string[] | undefined {
  const values = text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? values : undefined;
}

const LIST_FIELDS = [
  ["includeFields", "include"],
  ["excludeFields", "exclude"],
  ["searchableAttributes", "searchable"],
  ["filterableAttributes", "filterable"],
  ["sortableAttributes", "sortable"],
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [primaryKey, setPrimaryKey] = useState<string>("");
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [fields, setFields] = useState<DiscoveredField[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (collection && initializedFor !== collection.id) {
    setInitializedFor(collection.id);
    setDrafts(
      Object.fromEntries(
        LIST_FIELDS.map(([key]) => [key, toText(collection.fieldMapping[key])]),
      ),
    );
    setPrimaryKey(collection.fieldMapping.primaryKey ?? "");
    setFields(null);
  }

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
      const result = await api.projects.collections.discoverFields(
        projectId,
        input,
      );
      setFields(result.fields);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const save = async () => {
    if (!collection) return;
    setBusy(true);
    try {
      const fieldMapping: FieldMapping = {
        primaryKey: primaryKey.trim() || undefined,
      };
      for (const [key] of LIST_FIELDS) {
        fieldMapping[key] = toList(drafts[key] ?? "");
      }
      await api.projects.collections.update(projectId, collection.id, {
        fieldMapping,
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
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Field mapping — {collection?.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {LIST_FIELDS.map(([key, label]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`mapping-${key}`} className="text-xs">
                {label}
              </Label>
              <Textarea
                id={`mapping-${key}`}
                rows={2}
                className="font-mono text-xs"
                value={drafts[key] ?? ""}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mapping-primary-key" className="text-xs">
              primary key
            </Label>
            <Input
              id="mapping-primary-key"
              className="font-mono text-xs"
              value={primaryKey}
              onChange={(event) => setPrimaryKey(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void discover()}>
              Discover fields
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void save()}>
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
