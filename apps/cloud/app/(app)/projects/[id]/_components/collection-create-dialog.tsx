"use client";

import {
  type CreateCollectionInput,
  createCollectionInputSchema,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { JsonEditor, useJsonDraft } from "@/components/json-editor";
import { api, errorMessage } from "@/lib/api";

const TEMPLATES = [
  {
    label: "mongodb",
    value: {
      name: "",
      sourceType: "mongodb",
      mongoDatabase: "",
      mongoCollection: "",
      fieldMapping: {
        searchableAttributes: [],
        filterableAttributes: [],
        sortableAttributes: [],
      },
    },
  },
  {
    label: "postgres",
    value: {
      name: "",
      sourceType: "postgres",
      pgDatabase: "",
      pgSchema: "public",
      pgTable: "",
      pgIdColumn: "id",
      fieldMapping: {
        searchableAttributes: [],
        filterableAttributes: [],
        sortableAttributes: [],
      },
    },
  },
] as const;

const TEMPLATE = TEMPLATES[0].value;

interface PgSource {
  database: string;
  schemas: Record<string, string[]>;
}

function PgSourceReference({ projectId }: { projectId: string }) {
  const [sources, setSources] = useState<PgSource[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const databases = await api.projects.pgSources.databases(projectId);
        const resolved = await Promise.all(
          databases.map(async (database) => {
            const schemas = await api.projects.pgSources.schemas(
              projectId,
              database,
            );
            const entries = await Promise.all(
              schemas.map(
                async (schema) =>
                  [
                    schema,
                    await api.projects.pgSources.tables(
                      projectId,
                      database,
                      schema,
                    ),
                  ] as const,
              ),
            );
            return { database, schemas: Object.fromEntries(entries) };
          }),
        );
        if (!cancelled) setSources(resolved);
      } catch {
        if (!cancelled) setSources([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (sources === null) return null;

  return (
    <div className="flex flex-col gap-1 border-t pt-3">
      <span className="text-[11px] text-muted-foreground">pg sources</span>
      <div className="max-h-32 overflow-y-auto font-mono text-[11px] text-muted-foreground">
        {sources.length === 0 && <span>—</span>}
        {sources.map((source) =>
          Object.entries(source.schemas).map(([schema, tables]) => (
            <div key={`${source.database}.${schema}`} className="truncate">
              <span className="text-foreground/70">
                {source.database}.{schema}
              </span>{" "}
              {tables.join(" ") || "—"}
            </div>
          )),
        )}
      </div>
    </div>
  );
}

export function CollectionCreateDialog({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const draft = useJsonDraft<CreateCollectionInput>(
    createCollectionInputSchema,
    TEMPLATE,
  );

  const create = async () => {
    if (!draft.result.ok) return;
    setBusy(true);
    try {
      await api.projects.collections.create(projectId, draft.result.data);
      setOpen(false);
      draft.reset(TEMPLATE);
      onCreated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Plus className="size-3.5" />
          collection
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create search collection</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <JsonEditor
            id="collection-json"
            draft={draft}
            rows={18}
            templates={TEMPLATES}
          />
          <PgSourceReference projectId={projectId} />
          <Button
            disabled={busy || !draft.result.ok}
            onClick={() => void create()}
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
