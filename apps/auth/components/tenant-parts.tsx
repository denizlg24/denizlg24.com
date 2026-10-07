"use client";

import type {
  TenantMemberRole,
  TenantMfaPolicy,
  TenantSignupPolicy,
  TenantSummary,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import Link from "next/link";
import type { ReactNode } from "react";
import { SectionEmpty } from "./shell-frame";

export type TenantAccess = TenantSummary["access"];

export const ACCESS_LABELS: Record<TenantAccess, string> = {
  owner: "Owner",
  admin: "Admin",
  superuser: "Superuser",
};

export const ROLE_OPTIONS: {
  value: TenantMemberRole;
  label: string;
  detail: string;
}[] = [
  {
    value: "admin",
    label: "Admin",
    detail: "Creates and turns off clients, and manages who can sign in.",
  },
  {
    value: "owner",
    label: "Owner",
    detail: "Everything an admin does, plus the app's settings, APIs and team.",
  },
];

export const SIGNUP_OPTIONS: {
  value: TenantSignupPolicy;
  label: string;
  detail: string;
}[] = [
  {
    value: "open",
    label: "Open",
    detail: "Anyone can create a deniz account while signing in to this app.",
  },
  {
    value: "invite",
    label: "Invite only",
    detail:
      "New accounts need an invitation; people who already have one can sign in.",
  },
  {
    value: "closed",
    label: "Closed",
    detail: "Only people who already have a deniz account can sign in.",
  },
];

export const MFA_OPTIONS: {
  value: TenantMfaPolicy;
  label: string;
  detail: string;
}[] = [
  {
    value: "optional",
    label: "Optional",
    detail: "A password is enough; two-factor stays each person's choice.",
  },
  {
    value: "required",
    label: "Required",
    detail: "Only people who have two-factor authentication on can sign in.",
  },
];

export const VERIFIED_EMAIL_DETAIL =
  "People have to confirm their email address before this app gets a token for them.";

export function signupLabel(policy: TenantSignupPolicy): string {
  return (
    SIGNUP_OPTIONS.find((option) => option.value === policy)?.label ?? policy
  );
}

/** Settings, APIs and the team are an owner's; admins run clients and users. */
export function canAdminister(access: TenantAccess): boolean {
  return access === "owner" || access === "superuser";
}

/** Managing an app means managing other people's access, so it needs a second factor. */
export function TwoFactorRequired() {
  return (
    <SectionEmpty
      action={
        <Button asChild variant="outline">
          <Link href="/security">Go to Security</Link>
        </Button>
      }
    >
      Turn on two-factor authentication to manage apps. Managing an app means
      deciding who can sign in to it, so it needs more than a password.
    </SectionEmpty>
  );
}

export function TenantNotFound() {
  return (
    <SectionEmpty
      action={
        <Button asChild variant="outline">
          <Link href="/apps">All apps</Link>
        </Button>
      }
    >
      There's no app at this address that you manage. It may have been deleted,
      or you may have been removed from its team.
    </SectionEmpty>
  );
}

/** A line under a section telling an admin why its controls are missing. */
export function OwnerOnlyNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
