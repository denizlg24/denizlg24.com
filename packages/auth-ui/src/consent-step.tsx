"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/avatar";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import type { ReactNode } from "react";
import { StepAlert, StepButton, StepHeading } from "./flow-step";

export interface ConsentClient {
  name: string;
  logoUri: string | null;
  /** Host of the client's homepage, when it published one. */
  homepage: string | null;
  /** Dynamically registered: nobody vetted it, so the screen says so. */
  registeredItself: boolean;
}

export interface ConsentItem {
  label: string;
  /** Mono detail beside the label: a host, an identifier. */
  detail?: string | null;
}

export function ConsentStep({
  client,
  resources,
  scopes,
  account,
  switchAccountHref,
  error,
  busy,
  onAllow,
  onDeny,
}: {
  /** `null` while the client's public record is still loading. */
  client: ConsentClient | null;
  resources: ConsentItem[];
  scopes: ConsentItem[];
  /** `null` while unknown; the line is omitted rather than guessed. */
  account: { username: string } | null;
  switchAccountHref: string;
  error?: string | null;
  busy: boolean;
  onAllow: () => void;
  onDeny: () => void;
}) {
  const name = client ? (
    client.name
  ) : (
    <Skeleton className="inline-block h-6 w-28 translate-y-0.5" />
  );

  return (
    <div className="flex flex-col gap-8">
      <StepHeading>Allow {name} to use your account?</StepHeading>
      {error ? <StepAlert>{error}</StepAlert> : null}

      <div className="flex items-center gap-3">
        <Avatar size="lg" className="rounded-md">
          {client?.logoUri ? (
            <AvatarImage src={client.logoUri} alt="" className="rounded-md" />
          ) : null}
          <AvatarFallback className="rounded-md text-base">
            {client ? client.name.slice(0, 1).toUpperCase() : ""}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col">
          {client ? (
            <span className="truncate text-sm font-medium text-accent-strong">
              {client.name}
            </span>
          ) : (
            <Skeleton className="h-4 w-32" />
          )}
          {client?.homepage ? (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {client.homepage}
            </span>
          ) : client?.registeredItself ? (
            <span className="text-xs text-muted-foreground">
              Registered itself
            </span>
          ) : null}
        </div>
      </div>
      {client?.registeredItself ? (
        <StepAlert tone="notice">
          This app registered itself; nobody has checked it. Only allow it if
          you started this from the app.
        </StepAlert>
      ) : null}

      <dl className="flex flex-col divide-y border-y text-sm">
        <ConsentSection title="It can reach">
          <ItemList items={resources} empty="Nothing in particular" />
        </ConsentSection>
        <ConsentSection title="It can">
          <ItemList items={scopes} empty="Only confirm who you are" />
        </ConsentSection>
        {account ? (
          <ConsentSection title="As">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-accent-strong">
                {account.username}
              </span>
              <a
                href={switchAccountHref}
                className="text-muted-foreground underline-offset-4 hover:text-accent-strong hover:underline"
              >
                Not you? Sign out
              </a>
            </span>
          </ConsentSection>
        ) : null}
      </dl>

      <div className="grid grid-cols-2 gap-3">
        <StepButton
          type="button"
          busy={busy}
          disabled={!client}
          onClick={onAllow}
        >
          Allow
        </StepButton>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 text-base"
          disabled={busy}
          onClick={onDeny}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}

function ConsentSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3 py-3">
      <dt className="text-muted-foreground">{title}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function ItemList({ items, empty }: { items: ConsentItem[]; empty: string }) {
  if (items.length === 0) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li
          key={`${item.label}:${item.detail ?? ""}`}
          className="flex min-w-0 flex-wrap items-baseline gap-x-2"
        >
          <span className="text-accent-strong">{item.label}</span>
          {item.detail ? (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {item.detail}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
