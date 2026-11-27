"use client";

import { ArrowRight } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Field =
  | "name"
  | "email"
  | "company"
  | "role"
  | "seats"
  | "interest"
  | "message";

const fields = new Set<string>([
  "name",
  "email",
  "company",
  "role",
  "seats",
  "interest",
  "message",
]);
const isField = (value: unknown): value is Field =>
  typeof value === "string" && fields.has(value);

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent" }
  | { state: "error"; message: string; field?: Field };

export function EnquiryForm({
  interests,
  seatOptions,
  initialInterest,
}: {
  interests: readonly string[];
  seatOptions: readonly string[];
  initialInterest: string;
}) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (status.state === "sent") doneRef.current?.focus();
    if (status.state === "error" && status.field)
      formRef.current
        ?.querySelector<HTMLElement>(`[name="${status.field}"]`)
        ?.focus();
  }, [status]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === "string" ? value : "";
    };
    setStatus({ state: "sending" });
    try {
      const response = await fetch("/api/enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: text("name"),
          email: text("email").trim(),
          company: text("company"),
          role: text("role"),
          seats: text("seats") || null,
          interest: text("interest"),
          message: text("message"),
          website: text("website"),
        }),
      });
      const body: { ok?: boolean; error?: string; field?: unknown } =
        await response.json().catch(() => ({}));
      if (response.ok && body.ok) {
        setStatus({ state: "sent" });
        return;
      }
      setStatus({
        state: "error",
        message: body.error ?? "The enquiry could not be sent. Try again.",
        field: isField(body.field) ? body.field : undefined,
      });
    } catch {
      setStatus({
        state: "error",
        message:
          "The connection dropped before the enquiry was sent. Try again.",
      });
    }
  };

  if (status.state === "sent")
    return (
      <p className="enquiry-done" ref={doneRef} tabIndex={-1} role="status">
        Received. You’ll hear from us within two business days.
      </p>
    );

  const sending = status.state === "sending";
  const errorFor = (field: Field) =>
    status.state === "error" && status.field === field ? status.message : null;
  const describe = (field: Field) =>
    errorFor(field) ? `${field}-error` : undefined;
  const fieldError = (field: Field) => {
    const message = errorFor(field);
    return message ? (
      <p className="enquiry-error" id={`${field}-error`}>
        {message}
      </p>
    ) : null;
  };

  return (
    <form
      ref={formRef}
      className="enquiry"
      onSubmit={submit}
      noValidate
      aria-busy={sending}
    >
      <fieldset disabled={sending}>
        <legend className="sr-only">Desk enquiry</legend>
        <div className="enquiry-row">
          <label htmlFor="enquiry-name">Name</label>
          <div>
            <input
              id="enquiry-name"
              name="name"
              autoComplete="name"
              required
              maxLength={120}
              aria-invalid={Boolean(errorFor("name")) || undefined}
              aria-describedby={describe("name")}
            />
            {fieldError("name")}
          </div>
        </div>
        <div className="enquiry-row">
          <label htmlFor="enquiry-email">Work email</label>
          <div>
            <input
              id="enquiry-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={200}
              spellCheck={false}
              aria-invalid={Boolean(errorFor("email")) || undefined}
              aria-describedby={describe("email")}
            />
            {fieldError("email")}
          </div>
        </div>
        <div className="enquiry-row">
          <label htmlFor="enquiry-company">
            Company <span>optional</span>
          </label>
          <div>
            <input
              id="enquiry-company"
              name="company"
              autoComplete="organization"
              maxLength={160}
              aria-invalid={Boolean(errorFor("company")) || undefined}
              aria-describedby={describe("company")}
            />
            {fieldError("company")}
          </div>
        </div>
        <div className="enquiry-row">
          <label htmlFor="enquiry-role">
            Role <span>optional</span>
          </label>
          <div>
            <input
              id="enquiry-role"
              name="role"
              autoComplete="organization-title"
              maxLength={120}
              aria-invalid={Boolean(errorFor("role")) || undefined}
              aria-describedby={describe("role")}
            />
            {fieldError("role")}
          </div>
        </div>
        <div className="enquiry-row">
          <label htmlFor="enquiry-seats">
            Seats <span>optional</span>
          </label>
          <div>
            <select
              id="enquiry-seats"
              name="seats"
              defaultValue=""
              aria-invalid={Boolean(errorFor("seats")) || undefined}
              aria-describedby={describe("seats")}
            >
              <option value="">Not sure yet</option>
              {seatOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {fieldError("seats")}
          </div>
        </div>
        <div className="enquiry-row">
          <label htmlFor="enquiry-interest">Interested in</label>
          <div>
            <select
              id="enquiry-interest"
              name="interest"
              defaultValue={initialInterest}
              aria-invalid={Boolean(errorFor("interest")) || undefined}
              aria-describedby={describe("interest")}
            >
              {interests.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {fieldError("interest")}
          </div>
        </div>
        <div className="enquiry-row enquiry-row-tall">
          <label htmlFor="enquiry-message">What should we know?</label>
          <div>
            <textarea
              id="enquiry-message"
              name="message"
              required
              rows={5}
              minLength={10}
              maxLength={4000}
              placeholder="How the desk works today, which markets you cover, what you would want on day one."
              aria-invalid={Boolean(errorFor("message")) || undefined}
              aria-describedby={describe("message")}
            />
            {fieldError("message")}
          </div>
        </div>
        <div className="enquiry-trap" aria-hidden>
          <label htmlFor="enquiry-website">Website</label>
          <input
            id="enquiry-website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        <div className="enquiry-submit">
          <Button type="submit" size="lg">
            {sending ? "Sending…" : "Send enquiry"}
            {sending ? null : <ArrowRight />}
          </Button>
          {status.state === "error" && !status.field ? (
            <p className="enquiry-error" role="alert">
              {status.message}
            </p>
          ) : (
            <p className="enquiry-note">
              Read by a person, answered within two business days.
            </p>
          )}
        </div>
      </fieldset>
    </form>
  );
}
