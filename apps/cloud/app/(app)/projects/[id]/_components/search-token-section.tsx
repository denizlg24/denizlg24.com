"use client";

import { formatDateTime } from "@repo/cloud-ui/format";
import {
  type SafeProject,
  type SearchRules,
  type SearchTokenResult,
  searchRulesSchema,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { JsonEditor, useJsonDraft } from "@repo/ui/json-editor";
import { Label } from "@repo/ui/label";
import { SecretValue } from "@repo/ui/secret-value";
import { Section } from "@repo/ui/section";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

const TEMPLATES = [
  { label: "all indexes", value: { "*": null } },
  { label: "filtered", value: { "*": { filter: "tenantId = 1" } } },
  {
    label: "per index",
    value: {
      "index-uid": { filter: "published = true" },
      "other-index": null,
    },
  },
] as const;

const TEMPLATE = TEMPLATES[0].value;

export function SearchTokenSection({ project }: { project: SafeProject }) {
  const [hours, setHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SearchTokenResult | null>(null);
  const draft = useJsonDraft<SearchRules>(searchRulesSchema, TEMPLATE);

  const generate = async () => {
    if (!draft.result.ok) return;
    setBusy(true);
    try {
      const searchRules = draft.result.data;
      setResult(
        await api.projects.searchToken(project.id, {
          expiresInHours: Number(hours) || undefined,
          searchRules:
            Object.keys(searchRules).length > 0 ? searchRules : undefined,
        }),
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="search tokens">
      <div className="flex flex-col gap-4">
        {project.meiliApiKey && (
          <SecretValue label="project search key" value={project.meiliApiKey} />
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="token-rules" className="text-xs">
            searchRules
          </Label>
          <JsonEditor
            id="token-rules"
            draft={draft}
            rows={8}
            templates={TEMPLATES}
          />
        </div>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="token-ttl" className="text-xs">
              TTL hours
            </Label>
            <Input
              id="token-ttl"
              inputMode="numeric"
              className="w-24 font-mono text-sm"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || !draft.result.ok}
            onClick={() => void generate()}
          >
            Generate
          </Button>
        </div>
        {result && (
          <SecretValue
            label={`tenant token — expires ${formatDateTime(result.expiresAt)}`}
            value={result.token}
          />
        )}
      </div>
    </Section>
  );
}
