"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import {
  type TenantSummary,
  updateTenantInputSchema,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Spinner } from "@repo/ui/spinner";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { tenantsApi } from "@/lib/tenants-api";
import { PageSection } from "./shell-frame";
import { canAdminister, OwnerOnlyNote } from "./tenant-parts";
import { type TenantPolicy, TenantPolicyFields } from "./tenant-policy-fields";
import {
  type FieldErrors,
  fieldErrorsOf,
  profileDraftOf,
  type TenantProfileDraft,
  TenantProfileFields,
  urlOrNull,
} from "./tenant-profile-fields";

function policyOf(tenant: TenantSummary): TenantPolicy {
  return {
    signup: tenant.signup,
    mfa: tenant.mfa,
    requireVerifiedEmail: tenant.requireVerifiedEmail,
  };
}

function sameProfile(a: TenantProfileDraft, b: TenantProfileDraft): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.homepageUrl.trim() === b.homepageUrl.trim() &&
    a.logoUrl.trim() === b.logoUrl.trim() &&
    a.privacyUrl.trim() === b.privacyUrl.trim() &&
    a.termsUrl.trim() === b.termsUrl.trim()
  );
}

function samePolicy(a: TenantPolicy, b: TenantPolicy): boolean {
  return (
    a.signup === b.signup &&
    a.mfa === b.mfa &&
    a.requireVerifiedEmail === b.requireVerifiedEmail
  );
}

function SaveRow({
  dirty,
  busy,
  saved,
  error,
}: {
  dirty: boolean;
  busy: boolean;
  saved: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="submit"
        aria-busy={busy || undefined}
        disabled={!dirty || busy}
      >
        {busy ? <Spinner aria-hidden="true" /> : null}
        Save
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : saved && !dirty ? (
        <p className="text-xs text-muted-foreground" role="status">
          Saved
        </p>
      ) : null}
    </div>
  );
}

function ProfileSection({
  tenant,
  editable,
  onSaved,
}: {
  tenant: TenantSummary;
  editable: boolean;
  onSaved: () => Promise<void>;
}) {
  const stored = profileDraftOf(tenant);
  const [draft, setDraft] = useState<TenantProfileDraft>(stored);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = !sameProfile(draft, stored);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = updateTenantInputSchema.safeParse({
      name: draft.name,
      homepageUrl: urlOrNull(draft.homepageUrl),
      logoUrl: urlOrNull(draft.logoUrl),
      privacyUrl: urlOrNull(draft.privacyUrl),
      termsUrl: urlOrNull(draft.termsUrl),
    });
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const updated = await tenantsApi.update(tenant.slug, parsed.data);
      setDraft(profileDraftOf(updated));
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  };

  return (
    <PageSection title="Profile">
      <form
        noValidate
        onSubmit={submit}
        className="flex max-w-xl flex-col gap-5"
      >
        <TenantProfileFields
          idPrefix="app-profile"
          value={draft}
          errors={errors}
          disabled={!editable || busy}
          onChange={(next) => {
            setDraft(next);
            setSaved(false);
          }}
        />
        {editable ? (
          <SaveRow dirty={dirty} busy={busy} saved={saved} error={error} />
        ) : null}
      </form>
    </PageSection>
  );
}

function PolicySection({
  tenant,
  editable,
  onSaved,
}: {
  tenant: TenantSummary;
  editable: boolean;
  onSaved: () => Promise<void>;
}) {
  const stored = policyOf(tenant);
  const [draft, setDraft] = useState<TenantPolicy>(stored);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = !samePolicy(draft, stored);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const updated = await tenantsApi.update(tenant.slug, draft);
      setDraft(policyOf(updated));
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  };

  return (
    <PageSection title="Sign-in rules">
      <form onSubmit={submit} className="flex max-w-xl flex-col gap-6">
        <TenantPolicyFields
          idPrefix="app-policy"
          value={draft}
          disabled={!editable || busy}
          onChange={(next) => {
            setDraft(next);
            setSaved(false);
          }}
        />
        {editable ? (
          <SaveRow dirty={dirty} busy={busy} saved={saved} error={error} />
        ) : null}
      </form>
    </PageSection>
  );
}

function ControlRow({
  title,
  detail,
  action,
}: {
  title: string;
  detail: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 max-w-prose flex-col gap-0.5">
        <span className="text-sm text-accent-strong">{title}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      {action}
    </div>
  );
}

/** The service owner's levers: switching an app off, and deleting it. */
function AvailabilitySection({
  tenant,
  onChanged,
  onDeleted,
}: {
  tenant: TenantSummary;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const setDisabled = async (disabled: boolean) => {
    setBusy(true);
    try {
      await tenantsApi.update(tenant.slug, { disabled });
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setBusy(false);
  };

  return (
    <PageSection title="Availability">
      <div className="flex flex-col">
        {tenant.disabled ? (
          <ControlRow
            title="Disabled"
            detail="Nobody can sign in to this app until it is enabled again."
            action={
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void setDisabled(false)}
              >
                Enable app
              </Button>
            }
          />
        ) : (
          <ControlRow
            title="Active"
            detail="People can sign in to this app under the rules above."
            action={
              <ConfirmButton
                trigger={
                  <Button variant="outline" disabled={busy}>
                    Disable app
                  </Button>
                }
                title={`Disable ${tenant.name}?`}
                description="Nobody can sign in to it, and people already signed in are cut off when their current token runs out, within 15 minutes. Its settings, clients and team are kept."
                actionLabel="Disable"
                onConfirm={() => setDisabled(true)}
              />
            }
          />
        )}
        <ControlRow
          title="Delete app"
          detail="Removes its clients, APIs and team, and signs everyone out of it. People keep their deniz accounts."
          action={
            <TypedConfirmDialog
              trigger={
                <Button variant="outline" disabled={busy}>
                  Delete app
                </Button>
              }
              title={`Type the slug to delete ${tenant.name}`}
              keyword={tenant.slug}
              actionLabel="Delete app for good"
              onConfirm={async () => {
                await tenantsApi.remove(tenant.slug);
                onDeleted();
              }}
            />
          }
        />
      </div>
    </PageSection>
  );
}

export function TenantSettings({
  tenant,
  onChanged,
  onDeleted,
}: {
  tenant: TenantSummary;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const editable = canAdminister(tenant.access);
  return (
    <div className="flex flex-col gap-8">
      {editable ? null : (
        <OwnerOnlyNote>
          Only an owner of this app can change its profile and sign-in rules.
        </OwnerOnlyNote>
      )}
      <ProfileSection tenant={tenant} editable={editable} onSaved={onChanged} />
      <PolicySection tenant={tenant} editable={editable} onSaved={onChanged} />
      {tenant.access === "superuser" ? (
        <AvailabilitySection
          tenant={tenant}
          onChanged={onChanged}
          onDeleted={onDeleted}
        />
      ) : null}
    </div>
  );
}
