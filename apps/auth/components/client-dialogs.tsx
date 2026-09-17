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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { RadioGroup, RadioGroupItem } from "@repo/ui/radio-group";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { type FormEvent, type ReactNode, useState } from "react";
import { errorMessage } from "@/lib/api";

const KINDS: {
  value: CreateOAuthClientInput["kind"];
  label: string;
  detail: string;
}[] = [
  {
    value: "service",
    label: "Service",
    detail: "Acts as you on its own with a secret. For servers and agents.",
  },
  {
    value: "web",
    label: "Web app",
    detail: "Sends people here to sign in and keeps a secret on its server.",
  },
  {
    value: "native",
    label: "Native app",
    detail:
      "Sends people here to sign in from an installed app. No secret; PKCE.",
  },
];

function CredentialRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border px-3 py-2 font-mono text-sm">
          {value}
        </code>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
      {children}
    </div>
  );
}

export function CredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: OAuthClientCredentials | null;
  onClose: () => void;
}) {
  const hasSecret = typeof credentials?.clientSecret === "string";
  return (
    <Dialog
      open={credentials !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base">
            {hasSecret ? "Client secret" : "Client id"}
          </DialogTitle>
          <DialogDescription>
            {hasSecret
              ? "The secret is shown only now. Copy it into the app before closing this."
              : "A native client has no secret; the id is all it needs."}
          </DialogDescription>
        </DialogHeader>
        {credentials ? (
          <div className="flex flex-col gap-4">
            <CredentialRow label="Client id" value={credentials.clientId} />
            {credentials.clientSecret !== null ? (
              <CredentialRow
                label="Client secret"
                value={credentials.clientSecret}
              />
            ) : null}
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
  const [kind, setKind] = useState<CreateOAuthClientInput["kind"]>("service");
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
        kind === "service"
          ? { kind, name: name.trim(), resources: selected }
          : {
              kind,
              name: name.trim(),
              redirectUris: uris,
              resources: selected,
            },
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">New client</DialogTitle>
          <DialogDescription>
            An app or service that signs in with your account. You get its id
            and secret once it exists.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Kind</legend>
            <RadioGroup
              value={kind}
              onValueChange={(next) => {
                setKind(next === "web" || next === "native" ? next : "service");
              }}
              className="gap-2"
            >
              {KINDS.map((option) => (
                <label
                  key={option.value}
                  htmlFor={`client-kind-${option.value}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors has-[[data-state=checked]]:border-accent-strong has-[[data-state=checked]]:bg-surface",
                  )}
                >
                  <RadioGroupItem
                    id={`client-kind-${option.value}`}
                    value={option.value}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-accent-strong">
                      {option.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {option.detail}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-name">Name</Label>
            <Input
              id="client-name"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {kind !== "service" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="client-redirects">Redirect URIs</Label>
              <Textarea
                id="client-redirects"
                className="min-h-20 font-mono text-xs"
                spellCheck={false}
                aria-describedby="client-redirects-hint"
                value={redirectUris}
                onChange={(event) => setRedirectUris(event.target.value)}
              />
              <p
                id="client-redirects-hint"
                className="text-xs text-muted-foreground"
              >
                One per line. Where the browser is sent back with the code.
              </p>
            </div>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Resources</legend>
            {resources.map((resource) => (
              <label
                key={resource.identifier}
                htmlFor={`resource-${resource.identifier}`}
                className="flex cursor-pointer items-center gap-2.5 text-sm"
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
                <span className="text-accent-strong">{resource.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {resource.identifier}
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              What the client's tokens are good for. At least one.
            </p>
          </fieldset>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="submit"
              aria-busy={busy || undefined}
              disabled={busy || !valid}
            >
              {busy ? <Spinner aria-hidden="true" /> : null}
              Create client
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
