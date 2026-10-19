"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "./sign-in.module.css";

type Mode = "sign-in" | "sign-up" | "reset";

const otherTitles: Record<Exclude<Mode, "sign-in">, string> = {
  "sign-up": "Create a Macros account",
  reset: "Reset your password",
};

/**
 * The one email and password form for every web page that needs an account.
 * Without a `destination`, signing in re-renders the current page.
 */
export function SignIn({
  title,
  note,
  destination,
}: {
  title: string;
  note: string;
  destination?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "sign-in") {
        const result = await authClient.signIn.email({
          email: email.trim(),
          password,
        });
        if (result.error) {
          setError(
            result.error.code === "EMAIL_NOT_VERIFIED"
              ? "Verify your email first. We sent you a link when you signed up."
              : (result.error.message ?? "Those details didn’t match."),
          );
          return;
        }
        if (destination) router.push(destination);
        else router.refresh();
      } else if (mode === "sign-up") {
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
          callbackURL: "/register/verified",
        });
        if (result.error) {
          setError(result.error.message ?? "Couldn’t create the account.");
          return;
        }
        setNotice(
          "Check your inbox for a verification link, then sign in here.",
        );
        setMode("sign-in");
      } else {
        await authClient.requestPasswordReset({
          email: email.trim(),
          redirectTo: "/register/reset-password",
        });
        setNotice(
          "If that address has an account, a reset link is on its way.",
        );
        setMode("sign-in");
      }
    } catch {
      setError("Couldn’t connect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h1>{mode === "sign-in" ? title : otherTitles[mode]}</h1>
      <p className={styles.note}>{note}</p>
      {mode === "sign-up" ? (
        <label>
          <span>Name</span>
          <input
            autoComplete="name"
            required
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      ) : null}
      <label>
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      {mode !== "reset" ? (
        <label>
          <span>Password</span>
          <input
            type="password"
            autoComplete={
              mode === "sign-up" ? "new-password" : "current-password"
            }
            required
            minLength={8}
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      ) : null}
      <div aria-live="polite" className={styles.messages}>
        {error ? <p className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.note}>{notice}</p> : null}
      </div>
      <button type="submit" className={styles.submit} disabled={busy}>
        {busy
          ? "One moment…"
          : mode === "sign-in"
            ? "Sign in"
            : mode === "sign-up"
              ? "Create account"
              : "Send reset link"}
      </button>
      <div className={styles.switches}>
        {mode === "sign-in" ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("sign-up")}
            >
              Create an account
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("reset")}
            >
              Forgot password?
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("sign-in")}
          >
            Back to sign in
          </button>
        )}
      </div>
      <p className={styles.legal}>
        By continuing you agree to the <Link href="/terms">Terms</Link> and{" "}
        <Link href="/privacy">Privacy policy</Link>.
      </p>
    </form>
  );
}
