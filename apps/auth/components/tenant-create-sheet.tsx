"use client";

import { errorMessage, isApiError } from "@repo/cloud-ui/api-error";
import {
  createTenantInputSchema,
  type TenantSummary,
  tenantSlugSchema,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { Spinner } from "@repo/ui/spinner";
import { type FormEvent, useState } from "react";
import { tenantsApi } from "@/lib/tenants-api";
import {
  DEFAULT_TENANT_POLICY,
  type TenantPolicy,
  TenantPolicyFields,
} from "./tenant-policy-fields";
import {
  describedBy,
  EMPTY_PROFILE,
  type FieldErrors,
  FormField,
  fieldErrorsOf,
  type TenantProfileDraft,
  TenantProfileFields,
  urlOrNull,
} from "./tenant-profile-fields";

/** A slug suggestion from the name: what `tenantSlugSchema` accepts, or nothing. */
function slugFrom(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function TenantCreateSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (tenant: TenantSummary) => void;
}) {
  const [profile, setProfile] = useState<TenantProfileDraft>(EMPTY_PROFILE);
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [policy, setPolicy] = useState<TenantPolicy>(DEFAULT_TENANT_POLICY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveSlug = slugEdited ? slug : slugFrom(profile.name);

  const reset = () => {
    setProfile(EMPTY_PROFILE);
    setSlug("");
    setSlugEdited(false);
    setPolicy(DEFAULT_TENANT_POLICY);
    setErrors({});
    setFormError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = createTenantInputSchema.safeParse({
      slug: effectiveSlug,
      name: profile.name,
      homepageUrl: urlOrNull(profile.homepageUrl),
      logoUrl: urlOrNull(profile.logoUrl),
      privacyUrl: urlOrNull(profile.privacyUrl),
      termsUrl: urlOrNull(profile.termsUrl),
      ...policy,
    });
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const created = await tenantsApi.create(parsed.data);
      reset();
      onCreated(created);
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        setErrors({ slug: "Another app already uses this slug." });
      } else {
        setFormError(errorMessage(error));
      }
    }
    setBusy(false);
  };

  const slugId = "new-app-slug";
  const slugCheck = effectiveSlug
    ? tenantSlugSchema.safeParse(effectiveSlug)
    : null;
  const slugError =
    errors.slug ??
    (slugEdited && slugCheck && !slugCheck.success
      ? slugCheck.error.issues[0]?.message
      : undefined);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader className="pr-10">
          <SheetTitle className="text-base">New app</SheetTitle>
          <SheetDescription>
            A product that signs people in with deniz. Once it exists, add its
            APIs and clients, and invite the people who build it.
          </SheetDescription>
        </SheetHeader>
        <form
          id="new-app-form"
          noValidate
          onSubmit={submit}
          className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 pb-4"
        >
          <TenantProfileFields
            idPrefix="new-app"
            value={profile}
            errors={errors}
            disabled={busy}
            onChange={setProfile}
            afterName={
              <FormField
                id={slugId}
                label="Slug"
                hint="Part of its address here. Lowercase letters, digits and dashes; it can't be changed later."
                error={slugError}
              >
                <Input
                  id={slugId}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={40}
                  className="font-mono md:text-xs"
                  disabled={busy}
                  value={effectiveSlug}
                  aria-invalid={slugError ? true : undefined}
                  aria-describedby={describedBy(slugId, slugError, true)}
                  onChange={(event) => {
                    setSlugEdited(true);
                    setSlug(event.target.value);
                  }}
                />
              </FormField>
            }
          />
          <div className="flex flex-col gap-4 border-t pt-5">
            <h3 className="text-sm font-semibold text-accent-strong">
              Sign-in rules
            </h3>
            <TenantPolicyFields
              idPrefix="new-app"
              value={policy}
              disabled={busy}
              onChange={setPolicy}
            />
          </div>
          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
        </form>
        <SheetFooter className="border-t">
          <Button
            type="submit"
            form="new-app-form"
            aria-busy={busy || undefined}
            disabled={busy}
          >
            {busy ? <Spinner aria-hidden="true" /> : null}
            Create app
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
