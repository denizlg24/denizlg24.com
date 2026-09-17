"use client";

import { Alert, AlertDescription } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/label";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import { CircleAlert, Info } from "lucide-react";
import type { ComponentProps, FormEvent, ReactNode } from "react";

/** The question a step asks, as its only heading. */
export function StepHeading({
  children,
  lede,
  aside,
}: {
  children: ReactNode;
  /** One sentence under the question, when the question alone is not enough. */
  lede?: ReactNode;
  /** A text action that belongs to the heading — "Not you?" beside a name. */
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-balance text-2xl font-semibold tracking-tight text-accent-strong">
        {children}
      </h1>
      {lede || aside ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
          {lede ? <span>{lede}</span> : null}
          {aside}
        </p>
      ) : null}
    </div>
  );
}

/** A problem with the step as a whole, above the form. */
export function StepAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "notice";
  children: ReactNode;
}) {
  const Icon = tone === "error" ? CircleAlert : Info;
  return (
    <Alert variant={tone === "error" ? "destructive" : "default"}>
      <Icon aria-hidden="true" />
      <AlertDescription
        className={cn(
          tone === "error" ? "text-destructive" : "text-foreground",
        )}
      >
        {children}
      </AlertDescription>
    </Alert>
  );
}

export function StepForm({
  className,
  onSubmit,
  ...props
}: Omit<ComponentProps<"form">, "onSubmit"> & {
  onSubmit: () => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form
      onSubmit={submit}
      className={cn("flex flex-col gap-5", className)}
      {...props}
    />
  );
}

/** Label, control and the control's own error, in that order. */
export function FlowField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
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

/** Every flow control is 44 px tall and never below 16 px type: one thumb, no zoom. */
export const flowControlClass = "h-11 text-base md:text-base";

/** The step's one primary action. Busy keeps the label and adds a spinner. */
export function StepButton({
  busy = false,
  className,
  children,
  disabled,
  ...props
}: ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button
      size="lg"
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={cn("h-11 w-full text-base", className)}
      {...props}
    >
      {busy ? <Spinner aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

/** A secondary action set as text: "Use a passkey instead", "Back". */
export function TextAction({
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "-mx-1 inline-flex h-8 items-center rounded-sm px-1 text-left text-sm text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-accent-strong hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** The alternatives under the primary action, one per line. */
export function StepActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-start gap-1">{children}</div>;
}
