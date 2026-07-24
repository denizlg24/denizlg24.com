"use client";

import type { DbType, ProjectDatabase } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Label } from "@repo/ui/label";
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
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { SecretValue } from "@/components/secret-value";
import { Section } from "@/components/section";
import { TypedConfirmDialog } from "@/components/typed-confirm-dialog";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { usePoll } from "@/lib/use-poll";

const DB_TYPES: DbType[] = ["postgres", "mongodb", "redis"];

export function DatabasesSection({ projectId }: { projectId: string }) {
  const fetchDatabases = useCallback(
    () => api.projects.databases.list(projectId),
    [projectId],
  );
  const { data: databases, reload } = usePoll(fetchDatabases, null);

  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType] = useState<DbType>("postgres");
  const [busy, setBusy] = useState(false);
  const [provisioned, setProvisioned] = useState<ProjectDatabase | null>(null);

  const provision = async () => {
    setBusy(true);
    try {
      const database = await api.projects.databases.provision(projectId, type);
      setCreateOpen(false);
      setProvisioned(database);
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="databases"
      count={databases?.length}
      actions={
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost">
              <Plus className="size-3.5" />
              database
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Provision database</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={type}
                  onValueChange={(value) => setType(value as DbType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DB_TYPES.map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {entry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={busy} onClick={() => void provision()}>
                Provision
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      }
    >
      <Dialog
        open={provisioned !== null}
        onOpenChange={(next) => !next && setProvisioned(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {provisioned?.dbName} — credentials shown once
            </DialogTitle>
          </DialogHeader>
          {provisioned && (
            <div className="flex flex-col gap-3">
              <SecretValue label="username" value={provisioned.username} />
              <SecretValue label="password" value={provisioned.password} />
              <SecretValue
                label="internal uri"
                value={provisioned.uris.internal}
              />
              <SecretValue
                label="external uri"
                value={provisioned.uris.external}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>type</TableHead>
              <TableHead>name</TableHead>
              <TableHead>username</TableHead>
              <TableHead className="text-right">created</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(databases ?? []).map((database) => (
              <TableRow key={database.id}>
                <TableCell className="text-xs">{database.type}</TableCell>
                <TableCell className="font-mono text-xs">
                  {database.dbName}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {database.username}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatRelative(database.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <TypedConfirmDialog
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                      title={`Deprovision ${database.dbName}?`}
                      keyword={database.dbName}
                      actionLabel="Deprovision"
                      onConfirm={async () => {
                        try {
                          await api.projects.databases.deprovision(
                            projectId,
                            database.id,
                          );
                          toast.success(`Deprovisioned ${database.dbName}`);
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
            {databases?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
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
