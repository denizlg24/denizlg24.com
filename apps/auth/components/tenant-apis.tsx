"use client";

import { errorMessage, isApiError } from "@repo/cloud-ui/api-error";
import {
  createTenantResourceInputSchema,
  type OAuthClientSummary,
  type OAuthResourceSummary,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Spinner } from "@repo/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { tenantsApi } from "@/lib/tenants-api";
import { StackedRow } from "./account-parts";
import { PageSection, SectionEmpty } from "./shell-frame";
import {
  canAdminister,
  OwnerOnlyNote,
  type TenantAccess,
} from "./tenant-parts";
import {
  describedBy,
  type FieldErrors,
  FormField,
} from "./tenant-profile-fields";

function usedBy(identifier: string, clients: OAuthClientSummary[]): number {
  return clients.filter((client) => client.resources.includes(identifier))
    .length;
}

function usageLabel(count: number): string {
  if (count === 0) return "No clients";
  return count === 1 ? "1 client" : `${count} clients`;
}

function AddApiDialog({
  open,
  slug,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  slug: string;
  onOpenChange: (open: boolean) => void;
  onAdded: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = createTenantResourceInputSchema.safeParse({
      name,
      identifier: identifier.trim(),
    });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "name" && !next.name) {
          next.name = "Give the API a name, up to 80 characters.";
        }
        if (key === "identifier" && !next.identifier) {
          next.identifier =
            "Use the API's full address, starting with https://";
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await tenantsApi.addResource(slug, parsed.data);
      setName("");
      setIdentifier("");
      onOpenChange(false);
      await onAdded();
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        setErrors({
          identifier: "Another API is already registered with this address.",
        });
      } else {
        setFormError(errorMessage(error));
      }
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base">Add an API</DialogTitle>
          <DialogDescription>
            A server that accepts this app's tokens. Its identifier is the
            audience the tokens carry, so the server checks for exactly this
            value.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-5">
          <FormField id="api-name" label="Name" error={errors.name}>
            <Input
              id="api-name"
              autoComplete="off"
              maxLength={80}
              value={name}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describedBy("api-name", errors.name, false)}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField
            id="api-identifier"
            label="Identifier"
            hint="Usually the API's base URL, like https://api.example.com"
            error={errors.identifier}
          >
            <Input
              id="api-identifier"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              className="font-mono md:text-xs"
              value={identifier}
              aria-invalid={errors.identifier ? true : undefined}
              aria-describedby={describedBy(
                "api-identifier",
                errors.identifier,
                true,
              )}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </FormField>
          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" aria-busy={busy || undefined} disabled={busy}>
              {busy ? <Spinner aria-hidden="true" /> : null}
              Add API
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveApi({
  resource,
  clientCount,
  busy,
  onRemove,
}: {
  resource: OAuthResourceSummary;
  clientCount: number;
  busy: boolean;
  onRemove: () => Promise<void>;
}) {
  return (
    <ConfirmButton
      trigger={
        <Button size="sm" variant="ghost" disabled={busy}>
          Remove
        </Button>
      }
      title={`Remove ${resource.name}?`}
      description={
        clientCount === 0
          ? "No client uses it, so nothing changes for anyone signed in."
          : `${clientCount === 1 ? "The client that uses it stops" : `The ${clientCount} clients that use it stop`} getting tokens for it. Tokens already issued keep working until they run out.`
      }
      actionLabel="Remove"
      onConfirm={onRemove}
    />
  );
}

export function TenantApis({
  slug,
  access,
  resources,
  clients,
  onChanged,
}: {
  slug: string;
  access: TenantAccess;
  resources: OAuthResourceSummary[];
  clients: OAuthClientSummary[];
  onChanged: () => Promise<void>;
}) {
  const editable = canAdminister(access);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const remove = async (resource: OAuthResourceSummary) => {
    setBusyId(resource.identifier);
    try {
      await tenantsApi.removeResource(slug, resource.identifier);
    } catch (error) {
      toast.error(errorMessage(error));
    }
    await onChanged();
    setBusyId(null);
  };

  const addButton = (variant: "default" | "outline") => (
    <Button
      size={variant === "default" ? "sm" : "default"}
      variant={variant}
      disabled={!editable}
      onClick={() => setAdding(true)}
    >
      Add API
    </Button>
  );

  return (
    <PageSection
      title="APIs"
      count={resources.length}
      actions={resources.length > 0 ? addButton("default") : null}
    >
      {editable ? null : (
        <OwnerOnlyNote>
          Only an owner of this app can add or remove APIs.
        </OwnerOnlyNote>
      )}
      {resources.length === 0 ? (
        <SectionEmpty action={editable ? addButton("outline") : null}>
          No APIs yet. An API is a server that accepts this app's tokens; add
          one before creating a client, since every client is issued tokens for
          at least one.
        </SectionEmpty>
      ) : (
        <>
          <ul className="flex flex-col sm:hidden">
            {resources.map((resource) => (
              <StackedRow
                key={resource.identifier}
                title={<span className="truncate">{resource.name}</span>}
                detail={
                  <>
                    <span className="break-all font-mono">
                      {resource.identifier}
                    </span>
                    {" · "}
                    {usageLabel(usedBy(resource.identifier, clients))}
                  </>
                }
                actions={
                  editable ? (
                    <RemoveApi
                      resource={resource}
                      clientCount={usedBy(resource.identifier, clients)}
                      busy={busyId === resource.identifier}
                      onRemove={() => remove(resource)}
                    />
                  ) : null
                }
              />
            ))}
          </ul>
          <Table containerClassName="hidden sm:block">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Identifier</TableHead>
                <TableHead>Used by</TableHead>
                {editable ? (
                  <TableHead className="sr-only">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.map((resource) => (
                <TableRow key={resource.identifier}>
                  <TableCell className="max-w-48 truncate text-accent-strong">
                    {resource.name}
                  </TableCell>
                  <TableCell className="max-w-80 truncate font-mono text-xs text-muted-foreground">
                    {resource.identifier}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {usageLabel(usedBy(resource.identifier, clients))}
                  </TableCell>
                  {editable ? (
                    <TableCell className="text-right">
                      <RemoveApi
                        resource={resource}
                        clientCount={usedBy(resource.identifier, clients)}
                        busy={busyId === resource.identifier}
                        onRemove={() => remove(resource)}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {editable ? (
        <AddApiDialog
          open={adding}
          slug={slug}
          onOpenChange={setAdding}
          onAdded={onChanged}
        />
      ) : null}
    </PageSection>
  );
}
