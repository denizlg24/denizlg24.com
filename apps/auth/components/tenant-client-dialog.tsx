"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import type {
  CreateOAuthClientInput,
  OAuthResourceSummary,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
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
import { type FormEvent, useState } from "react";

type ClientKind = CreateOAuthClientInput["kind"];

const KINDS: { value: ClientKind; label: string; detail: string }[] = [
  {
    value: "web",
    label: "Web app",
    detail:
      "A site with a server. People sign in here and come back with a code; the server keeps a secret.",
  },
  {
    value: "native",
    label: "Native app",
    detail:
      "Installed on people's devices, or running entirely in their browser, so it can't keep a secret. Uses PKCE.",
  },
  {
    value: "service",
    label: "Service",
    detail:
      "A server acting on its own, with nobody signing in. Gets a secret and calls your APIs as itself.",
  },
];

function kindFrom(value: string): ClientKind {
  return KINDS.find((kind) => kind.value === value)?.value ?? "web";
}

/** A client of a tenant: the same three kinds as a first-party one, limited to the tenant's APIs. */
export function TenantClientDialog({
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
  const [kind, setKind] = useState<ClientKind>("web");
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
            One piece of this app that signs people in, or calls its APIs. You
            get its id, and its secret if it has one, once it exists.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Kind</legend>
            <RadioGroup
              value={kind}
              onValueChange={(next) => setKind(kindFrom(next))}
              className="gap-2"
            >
              {KINDS.map((option) => (
                <label
                  key={option.value}
                  htmlFor={`tenant-client-kind-${option.value}`}
                  className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors has-[[data-state=checked]]:border-accent-strong has-[[data-state=checked]]:bg-surface"
                >
                  <RadioGroupItem
                    id={`tenant-client-kind-${option.value}`}
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
            <Label htmlFor="tenant-client-name">Name</Label>
            <Input
              id="tenant-client-name"
              autoComplete="off"
              maxLength={100}
              aria-describedby="tenant-client-name-hint"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p
              id="tenant-client-name-hint"
              className="text-xs text-muted-foreground"
            >
              Shown to people on the consent screen and on their account.
            </p>
          </div>
          {kind !== "service" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="tenant-client-redirects">Redirect URIs</Label>
              <Textarea
                id="tenant-client-redirects"
                className="min-h-20 font-mono md:text-xs"
                spellCheck={false}
                aria-describedby="tenant-client-redirects-hint"
                value={redirectUris}
                onChange={(event) => setRedirectUris(event.target.value)}
              />
              <p
                id="tenant-client-redirects-hint"
                className="text-xs text-muted-foreground"
              >
                One per line. Where the browser is sent back after signing in.
              </p>
            </div>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">APIs</legend>
            {resources.map((resource) => (
              <label
                key={resource.identifier}
                htmlFor={`tenant-client-api-${resource.identifier}`}
                className="flex cursor-pointer items-center gap-2.5 text-sm"
              >
                <Checkbox
                  id={`tenant-client-api-${resource.identifier}`}
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
              What this client's tokens are good for. At least one.
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
