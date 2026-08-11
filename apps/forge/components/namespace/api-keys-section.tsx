"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { API_KEY_SCOPES, type CreatedApiKey } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { ConfirmButton } from "@repo/ui/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { SecretValue } from "@repo/ui/secret-value";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Plus, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

const EXPIRY_OPTIONS = ["none", "30d", "90d", "1y"] as const;

function CreatedKeyDialog({
  created,
  onClose,
}: {
  created: CreatedApiKey | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={created !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>API key — shown once</DialogTitle>
        </DialogHeader>
        {created && <SecretValue label="key" value={created.key} />}
      </DialogContent>
    </Dialog>
  );
}

export function ApiKeysSection({ projectId }: { projectId: string }) {
  const fetchKeys = useCallback(
    () => api.projects.apiKeys.list(projectId),
    [projectId],
  );
  const { data: keys, reload } = usePoll(fetchKeys, null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<(typeof EXPIRY_OPTIONS)[number]>("none");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.projects.apiKeys.create(projectId, {
        name: name.trim(),
        scopes,
        expiresIn: expiry === "none" ? undefined : expiry,
      });
      setCreateOpen(false);
      setName("");
      setScopes([]);
      setExpiry("none");
      setCreated(result);
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="api keys"
      count={keys?.length}
      actions={
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost">
              <Plus className="size-3.5" />
              key
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="key-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="key-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Scopes</Label>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {API_KEY_SCOPES.map((scope) => (
                    <label
                      key={scope}
                      className="flex items-center gap-2 font-mono text-xs"
                    >
                      <Checkbox
                        checked={scopes.includes(scope)}
                        onCheckedChange={(checked) =>
                          setScopes((current) =>
                            checked === true
                              ? [...current, scope]
                              : current.filter((entry) => entry !== scope),
                          )
                        }
                      />
                      {scope}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Expiry</Label>
                <Select
                  value={expiry}
                  onValueChange={(value) =>
                    setExpiry(value as (typeof EXPIRY_OPTIONS)[number])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={
                  busy || name.trim().length === 0 || scopes.length === 0
                }
                onClick={() => void create()}
              >
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      }
    >
      <CreatedKeyDialog created={created} onClose={() => setCreated(null)} />
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>name</TableHead>
              <TableHead>prefix</TableHead>
              <TableHead>scopes</TableHead>
              <TableHead className="text-right">last used</TableHead>
              <TableHead className="text-right">expires</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(keys ?? []).map((key) => (
              <TableRow key={key.id}>
                <TableCell className="text-sm">{key.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {key.keyPrefix}…
                </TableCell>
                <TableCell>
                  <div className="flex max-w-64 flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <Badge
                        key={scope}
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatRelative(key.lastUsedAt)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {key.expiresAt ? formatRelative(key.expiresAt) : "never"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-0.5">
                    <ConfirmButton
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Rotate ${key.name}`}
                        >
                          <RotateCw className="size-3.5" />
                        </Button>
                      }
                      title={`Rotate ${key.name}?`}
                      description="The current key stops working immediately."
                      actionLabel="Rotate"
                      onConfirm={async () => {
                        try {
                          const rotated = await api.projects.apiKeys.rotate(
                            projectId,
                            key.id,
                          );
                          setCreated(rotated);
                          void reload();
                        } catch (err) {
                          toast.error(errorMessage(err));
                        }
                      }}
                    />
                    <ConfirmButton
                      trigger={
                        <Button
                          aria-label={`Revoke ${key.name}`}
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                      title={`Revoke ${key.name}?`}
                      actionLabel="Revoke"
                      onConfirm={async () => {
                        try {
                          await api.projects.apiKeys.revoke(projectId, key.id);
                          void reload();
                        } catch (err) {
                          toast.error(errorMessage(err));
                        }
                      }}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {keys?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-12 text-center text-xs text-muted-foreground"
                >
                  —
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
