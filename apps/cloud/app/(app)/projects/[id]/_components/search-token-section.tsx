"use client";

import type { SafeProject, SearchTokenResult } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Textarea } from "@repo/ui/textarea";
import { useState } from "react";
import { toast } from "sonner";
import { SecretValue } from "@/components/secret-value";
import { Section } from "@/components/section";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export function SearchTokenSection({ project }: { project: SafeProject }) {
  const [hours, setHours] = useState("24");
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SearchTokenResult | null>(null);

  const generate = async () => {
    let searchRules: Record<string, { filter?: string } | null> | undefined;
    if (rules.trim().length > 0) {
      try {
        searchRules = JSON.parse(rules);
      } catch {
        toast.error("searchRules must be valid JSON");
        return;
      }
    }
    setBusy(true);
    try {
      setResult(
        await api.projects.searchToken(project.id, {
          expiresInHours: Number(hours) || undefined,
          searchRules,
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
        <div className="flex flex-wrap items-end gap-3">
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
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label htmlFor="token-rules" className="text-xs">
              searchRules JSON
            </Label>
            <Textarea
              id="token-rules"
              rows={1}
              placeholder='{"index-uid": {"filter": "..."}}'
              className="font-mono text-xs"
              value={rules}
              onChange={(event) => setRules(event.target.value)}
            />
          </div>
          <Button size="sm" disabled={busy} onClick={() => void generate()}>
            Generate
          </Button>
        </div>
        {result && (
          <div className="flex flex-col gap-2">
            <SecretValue
              label={`tenant token — expires ${formatDateTime(result.expiresAt)}`}
              value={result.token}
            />
          </div>
        )}
      </div>
    </Section>
  );
}
