"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { IssuedProjectS3Credential } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
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

export function S3CredentialsSection({ projectId }: { projectId: string }) {
  const fetchCredentials = useCallback(
    () => api.projects.s3Credentials.list(projectId),
    [projectId],
  );
  const { data: credentials, reload } = usePoll(fetchCredentials, null);
  const { data: legacy } = usePoll(api.storageAdmin.legacyS3Credentials, null);

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedProjectS3Credential | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.projects.s3Credentials.create(
        projectId,
        label.trim(),
      );
      setCreateOpen(false);
      setLabel("");
      setIssued(result);
      void reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const activeLegacy = (legacy ?? []).filter(
    (credential) => credential.revokedAt === null,
  );
  const activeCredentials = (credentials ?? []).filter(
    (credential) => credential.revokedAt === null,
  );

  return (
    <Section
      title="s3 credentials"
      count={credentials ? activeCredentials.length : undefined}
      actions={
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost">
              <Plus className="size-3.5" />
              credential
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Issue S3 credential</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="credential-label" className="text-xs">
                  Label
                </Label>
                <Input
                  id="credential-label"
                  autoFocus
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <Button
                disabled={busy || label.trim().length === 0}
                onClick={() => void create()}
              >
                Issue
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      }
    >
      <Dialog
        open={issued !== null}
        onOpenChange={(next) => !next && setIssued(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>S3 credential — secret shown once</DialogTitle>
          </DialogHeader>
          {issued && (
            <div className="flex flex-col gap-3">
              <SecretValue label="access key id" value={issued.accessKeyId} />
              <SecretValue
                label="secret access key"
                value={issued.secretAccessKey}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>label</TableHead>
              <TableHead>access key</TableHead>
              <TableHead className="text-right">last used</TableHead>
              <TableHead className="text-right">created</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeCredentials.map((credential) => (
              <TableRow key={credential.id}>
                <TableCell className="text-sm">{credential.label}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {credential.accessKeyId}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatRelative(credential.lastUsedAt)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatRelative(credential.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-0.5">
                    <ConfirmButton
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Rotate ${credential.label}`}
                        >
                          <RotateCw className="size-3.5" />
                        </Button>
                      }
                      title={`Rotate ${credential.label}?`}
                      description="The current secret stops working immediately."
                      actionLabel="Rotate"
                      onConfirm={async () => {
                        try {
                          const rotated =
                            await api.projects.s3Credentials.rotate(
                              projectId,
                              credential.id,
                            );
                          setIssued(rotated);
                          void reload();
                        } catch (err) {
                          toast.error(errorMessage(err));
                        }
                      }}
                    />
                    <ConfirmButton
                      trigger={
                        <Button
                          aria-label={`Revoke ${credential.label}`}
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                      title={`Revoke ${credential.label}?`}
                      actionLabel="Revoke"
                      onConfirm={async () => {
                        try {
                          await api.projects.s3Credentials.revoke(
                            projectId,
                            credential.id,
                          );
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
            {activeLegacy.map((credential) => (
              <TableRow key={credential.id} className="bg-muted/40">
                <TableCell className="text-sm">
                  {credential.label}
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    legacy shared · retire post-cutover
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {credential.accessKeyId}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatRelative(credential.lastUsedAt)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatRelative(credential.createdAt)}
                </TableCell>
                <TableCell />
              </TableRow>
            ))}
            {activeCredentials.length === 0 && activeLegacy.length === 0 && (
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
