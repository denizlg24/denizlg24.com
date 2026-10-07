"use client";

import type { TenantSummary } from "@repo/schemas/cloud";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import type { ReactNode } from "react";
import type { z } from "zod";

export interface TenantProfileDraft {
  name: string;
  homepageUrl: string;
  logoUrl: string;
  privacyUrl: string;
  termsUrl: string;
}

export type TenantProfileUrlField = Exclude<keyof TenantProfileDraft, "name">;

export const EMPTY_PROFILE: TenantProfileDraft = {
  name: "",
  homepageUrl: "",
  logoUrl: "",
  privacyUrl: "",
  termsUrl: "",
};

export function profileDraftOf(tenant: TenantSummary): TenantProfileDraft {
  return {
    name: tenant.name,
    homepageUrl: tenant.homepageUrl ?? "",
    logoUrl: tenant.logoUrl ?? "",
    privacyUrl: tenant.privacyUrl ?? "",
    termsUrl: tenant.termsUrl ?? "",
  };
}

/** An emptied field clears the stored URL rather than leaving it unchanged. */
export function urlOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type FieldErrors = Partial<Record<string, string>>;

const FRIENDLY_MESSAGES: Record<string, string> = {
  name: "Give the app a name, up to 80 characters.",
  homepageUrl: "Use a full address that starts with https://",
  logoUrl: "Use a full address that starts with https://",
  privacyUrl: "Use a full address that starts with https://",
  termsUrl: "Use a full address that starts with https://",
};

/** One message per field, the first the schema reported for it. */
export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || errors[key]) continue;
    errors[key] = FRIENDLY_MESSAGES[key] ?? issue.message;
  }
  return errors;
}

const URL_FIELDS: {
  key: TenantProfileUrlField;
  label: string;
  hint: string;
}[] = [
  {
    key: "homepageUrl",
    label: "Homepage",
    hint: "Linked from the sign-in screen.",
  },
  {
    key: "logoUrl",
    label: "Logo",
    hint: "A square image, shown over the sign-in steps and on people's accounts.",
  },
  {
    key: "privacyUrl",
    label: "Privacy policy",
    hint: "Linked on the consent screen.",
  },
  {
    key: "termsUrl",
    label: "Terms of service",
    hint: "Linked on the consent screen.",
  },
];

export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Ties a control to whichever of its hint or error is showing. */
export function describedBy(
  id: string,
  error: string | undefined,
  hasHint: boolean,
): string | undefined {
  if (error) return `${id}-error`;
  return hasHint ? `${id}-hint` : undefined;
}

/** Name and the public links of an app, as its sign-in screens show them. */
export function TenantProfileFields({
  idPrefix,
  value,
  errors,
  disabled = false,
  afterName,
  onChange,
}: {
  idPrefix: string;
  value: TenantProfileDraft;
  errors: FieldErrors;
  disabled?: boolean;
  /** A field that belongs next to the name, like the slug derived from it. */
  afterName?: ReactNode;
  onChange: (value: TenantProfileDraft) => void;
}) {
  const nameId = `${idPrefix}-name`;
  return (
    <div className="flex flex-col gap-5">
      <FormField
        id={nameId}
        label="Name"
        hint="What people see when they sign in."
        error={errors.name}
      >
        <Input
          id={nameId}
          autoComplete="off"
          maxLength={80}
          disabled={disabled}
          value={value.name}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy(nameId, errors.name, true)}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </FormField>
      {afterName}
      {URL_FIELDS.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const error = errors[field.key];
        return (
          <FormField
            key={field.key}
            id={id}
            label={field.label}
            hint={field.hint}
            error={error}
          >
            <Input
              id={id}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              className="font-mono md:text-xs"
              disabled={disabled}
              value={value[field.key]}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(id, error, true)}
              onChange={(event) =>
                onChange({ ...value, [field.key]: event.target.value })
              }
            />
          </FormField>
        );
      })}
    </div>
  );
}
