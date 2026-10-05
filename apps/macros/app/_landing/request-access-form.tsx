"use client";

import {
  type MacrosDistributionRequestStatus,
  macrosCreateDistributionRequestBodySchema,
  macrosDistributionRequestReceiptSchema,
} from "@repo/schemas/macros";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import { primaryButton } from "@/app/_landing/site";

type Field = "name" | "email" | "udid" | "note";

const field = "h-11 rounded-[12px] px-3.5";

const fieldMessages: Record<Field, string> = {
  name: "Enter your name.",
  email: "Enter a valid email address.",
  udid: "That doesn’t look like a UDID. It is 25 characters with one hyphen, like 00008030-001A2B3C4D5E6F70.",
  note: "Keep the note under 1,000 characters.",
};

const receivedCopy: Record<MacrosDistributionRequestStatus, string> = {
  pending:
    "Request received. You’ll get an email with an install link once your iPhone has been added.",
  approved:
    "This iPhone is already approved. The install link arrives by email as soon as the next build is ready.",
  declined: "A request for this iPhone was already reviewed and declined.",
};

function isField(value: unknown): value is Field {
  return (
    value === "name" ||
    value === "email" ||
    value === "udid" ||
    value === "note"
  );
}

export function RequestAccessForm() {
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [received, setReceived] =
    useState<MacrosDistributionRequestStatus | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" ? value : "";
    };
    const input = {
      name: text("name"),
      email: text("email"),
      udid: text("udid"),
      note: text("note") || undefined,
      website: text("website") || undefined,
    };

    const parsed = macrosCreateDistributionRequestBodySchema.safeParse(input);
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (isField(field)) next[field] = fieldMessages[field];
      }
      setErrors(next);
      setFormError("");
      return;
    }

    setErrors({});
    setFormError("");
    setSubmitting(true);
    const response = await fetch("/api/distribution/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    }).catch(() => null);
    setSubmitting(false);

    if (!response) {
      setFormError(
        "Couldn’t reach the server. Check your connection and try again.",
      );
      return;
    }
    if (response.status === 429) {
      setFormError("Too many attempts. Try again in a few minutes.");
      return;
    }
    const receipt = macrosDistributionRequestReceiptSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!response.ok || !receipt.success) {
      setFormError("Something went wrong. Try again in a moment.");
      return;
    }
    setReceived(receipt.data.status);
  }

  if (received) {
    return (
      <div role="status" className="border-t pt-6">
        <p className="text-[15px] font-semibold">Thanks.</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
          {receivedCopy[received]}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="access-name">Name</Label>
        <Input
          id="access-name"
          name="name"
          autoComplete="name"
          aria-invalid={Boolean(errors.name)}
          maxLength={120}
          className={field}
        />
        <FieldError message={errors.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="access-email">Email</Label>
        <Input
          id="access-email"
          name="email"
          type="email"
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
          className={field}
        />
        <FieldError message={errors.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="access-udid">iPhone UDID</Label>
        <Input
          id="access-udid"
          name="udid"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="00008030-001A2B3C4D5E6F70"
          aria-invalid={Boolean(errors.udid)}
          className={cn(field, "font-mono tabular-nums")}
        />
        <FieldError message={errors.udid} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="access-note">
          Note <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="access-note"
          name="note"
          rows={3}
          maxLength={1000}
          aria-invalid={Boolean(errors.note)}
          className="rounded-[12px] px-3.5 py-2.5"
        />
        <FieldError message={errors.note} />
      </div>
      {/* Hidden from people; bots fill every field they find. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] size-px overflow-hidden"
      >
        <label htmlFor="access-website">Website</label>
        <input
          id="access-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className={cn(primaryButton, "w-full disabled:opacity-60 sm:w-auto")}
      >
        Request early access
        {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
      </button>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="text-xs leading-relaxed text-destructive">{message}</p>
  ) : null;
}
