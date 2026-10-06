"use client";

import type { TenantMfaPolicy, TenantSignupPolicy } from "@repo/schemas/cloud";
import { Checkbox } from "@repo/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@repo/ui/radio-group";
import {
  MFA_OPTIONS,
  SIGNUP_OPTIONS,
  VERIFIED_EMAIL_DETAIL,
} from "./tenant-parts";

export interface TenantPolicy {
  signup: TenantSignupPolicy;
  mfa: TenantMfaPolicy;
  requireVerifiedEmail: boolean;
}

/** The server's defaults for a new app: nobody new gets in until it's opened. */
export const DEFAULT_TENANT_POLICY: TenantPolicy = {
  signup: "closed",
  mfa: "optional",
  requireVerifiedEmail: true,
};

function OptionGroup<T extends string>({
  id,
  legend,
  options,
  value,
  disabled,
  onChange,
}: {
  id: string;
  legend: string;
  options: { value: T; label: string; detail: string }[];
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <RadioGroup
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          const option = options.find((candidate) => candidate.value === next);
          if (option) onChange(option.value);
        }}
        className="gap-3"
      >
        {options.map((option) => (
          <label
            key={option.value}
            htmlFor={`${id}-${option.value}`}
            className="flex cursor-pointer items-start gap-3 has-[button:disabled]:cursor-default"
          >
            <RadioGroupItem
              id={`${id}-${option.value}`}
              value={option.value}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm text-accent-strong">{option.label}</span>
              <span className="text-xs text-muted-foreground">
                {option.detail}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

/** Who may create an account through the app, and what signing in to it takes. */
export function TenantPolicyFields({
  idPrefix,
  value,
  disabled = false,
  onChange,
}: {
  idPrefix: string;
  value: TenantPolicy;
  disabled?: boolean;
  onChange: (value: TenantPolicy) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <OptionGroup
        id={`${idPrefix}-signup`}
        legend="New accounts"
        options={SIGNUP_OPTIONS}
        value={value.signup}
        disabled={disabled}
        onChange={(signup) => onChange({ ...value, signup })}
      />
      <OptionGroup
        id={`${idPrefix}-mfa`}
        legend="Two-factor"
        options={MFA_OPTIONS}
        value={value.mfa}
        disabled={disabled}
        onChange={(mfa) => onChange({ ...value, mfa })}
      />
      <label
        htmlFor={`${idPrefix}-verified-email`}
        className="flex cursor-pointer items-start gap-3 has-[button:disabled]:cursor-default"
      >
        <Checkbox
          id={`${idPrefix}-verified-email`}
          className="mt-0.5"
          checked={value.requireVerifiedEmail}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange({ ...value, requireVerifiedEmail: checked === true })
          }
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm text-accent-strong">
            Require a verified email
          </span>
          <span className="text-xs text-muted-foreground">
            {VERIFIED_EMAIL_DETAIL}
          </span>
        </span>
      </label>
    </div>
  );
}
