"use client";

import {
  type MacrosTestFlightSignupResponse,
  macrosTestFlightSignupResponseSchema,
} from "@repo/schemas/macros";
import { cn } from "@repo/ui/utils";
import { type FormEvent, useState } from "react";
import { primaryButton } from "@/app/_landing/site";

const fieldClass =
  "mt-2 h-12 w-full rounded-[14px] border border-border bg-background px-4 text-[15px] font-normal text-foreground outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-60";

export function TestFlightForm() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: MacrosTestFlightSignupResponse["status"];
    email: string;
  } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/testflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, firstName, lastName, website }),
      });
      const body: unknown = await response.json().catch(() => null);
      const parsed = macrosTestFlightSignupResponseSchema.safeParse(body);
      if (response.ok && parsed.success) {
        setResult({ status: parsed.data.status, email: email.trim() });
        return;
      }
      setError(
        body &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
          ? body.error
          : "Couldn’t send the invite. Please try again.",
      );
    } catch {
      setError("Couldn’t connect. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div role="status" className="flex flex-col gap-3 border-t pt-6">
        <p className="text-xl font-semibold tracking-tight">
          {result.status === "invited"
            ? "You’re on the list."
            : "You’re already on the list."}
        </p>
        <ol className="flex flex-col border-b">
          {[
            `Apple emails an invite to ${result.email} from TestFlight. It can take a little while, and if the current build is still in Apple’s review, it arrives once that’s done.`,
            "On your iPhone, install TestFlight from the App Store.",
            "Open the email on your iPhone and tap View in TestFlight, then Install.",
          ].map((step, index) => (
            <li
              key={step}
              className="grid grid-cols-[2rem_minmax(0,1fr)] border-t py-4 text-[15px] leading-relaxed"
            >
              <span className="font-figure text-muted-foreground">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex max-w-lg flex-col gap-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-[15px] font-medium">
          First name <span className="text-muted-foreground">(optional)</span>
          <input
            className={fieldClass}
            autoComplete="given-name"
            maxLength={60}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block text-[15px] font-medium">
          Last name <span className="text-muted-foreground">(optional)</span>
          <input
            className={fieldClass}
            autoComplete="family-name"
            maxLength={60}
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <label className="block text-[15px] font-medium">
        Email
        <input
          className={fieldClass}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
        <span className="mt-2 block text-sm font-normal text-muted-foreground">
          Use the email of the Apple Account on your iPhone, so the invite opens
          straight in TestFlight.
        </span>
      </label>
      <label aria-hidden="true" className="hidden">
        Website
        <input
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </label>
      {error ? (
        <p role="alert" className="text-[15px] text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className={cn(
          primaryButton,
          "w-fit disabled:cursor-not-allowed disabled:opacity-50",
        )}
        disabled={busy}
      >
        {busy ? "Sending invite…" : "Get the TestFlight invite"}
      </button>
    </form>
  );
}
