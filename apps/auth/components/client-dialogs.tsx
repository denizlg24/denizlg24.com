"use client";

import type {
  CreateOAuthClientInput,
  OAuthClientCredentials,
  OAuthResourceSummary,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { CopyButton } from "@repo/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { NativeSelect, NativeSelectOption } from "@repo/ui/native-select";
import { Textarea } from "@repo/ui/textarea";
import { type FormEvent, useState } from "react";
import { errorMessage } from "@/lib/api";

export function CredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: OAuthClientCredentials | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={credentials !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-sm">
            Client secret — shown once
          </DialogTitle>
        </DialogHeader>
        {credentials ? (
          <div className="flex flex-col gap-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-all font-mono">
                {credentials.clientId}
              </span>
              <CopyButton value={credentials.clientId} label="Copy client id" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-all font-mono">
                {credentials.clientSecret}
              </span>
              <CopyButton
                value={credentials.clientSecret}
                label="Copy client secret"
              />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateClientDialog({
  open,
  resources,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  resources: OAuthResourceSummary[];
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateOAuthClientInput) => Promise<void>;
}) {
  const [kind, setKind] = useState<"web" | "service">("service");
  const [name, setName] = useState("");
  const [redirectUris, setRedirectUris] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const uris = redirectUris
    .split(/\s+/)
    .map((uri) => uri.trim())
    .filter(Boolean);
  const valid =
    name.trim().length > 0 &&
    selected.length > 0 &&
    (kind === "service" || uris.length > 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate(
        kind === "web"
          ? { kind, name: name.trim(), redirectUris: uris, resources: selected }
          : { kind, name: name.trim(), resources: selected },
      );
      setName("");
      setRedirectUris("");
      setSelected([]);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-sm">New client</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 text-xs">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-kind" className="text-xs">
              Kind
            </Label>
            <NativeSelect
              id="client-kind"
              size="sm"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value === "web" ? "web" : "service")
              }
            >
              <NativeSelectOption value="service">
                service — client_credentials
              </NativeSelectOption>
              <NativeSelectOption value="web">
                web — authorization_code
              </NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-name" className="text-xs">
              Name
            </Label>
            <Input
              id="client-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {kind === "web" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-redirects" className="text-xs">
                Redirect URIs
              </Label>
              <Textarea
                id="client-redirects"
                className="font-mono text-xs"
                value={redirectUris}
                onChange={(event) => setRedirectUris(event.target.value)}
              />
            </div>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-xs font-medium">Resources</legend>
            {resources.map((resource) => (
              <label
                key={resource.identifier}
                htmlFor={`resource-${resource.identifier}`}
                className="flex items-center gap-2"
              >
                <Checkbox
                  id={`resource-${resource.identifier}`}
                  checked={selected.includes(resource.identifier)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked === true
                        ? [...current, resource.identifier]
                        : current.filter(
                            (identifier) => identifier !== resource.identifier,
                          ),
                    )
                  }
                />
                <span>{resource.name}</span>
                <span className="font-mono text-muted-foreground">
                  {resource.identifier}
                </span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={busy || !valid}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
