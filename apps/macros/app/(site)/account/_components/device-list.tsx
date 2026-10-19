"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { z } from "zod";
import type { AccountDevice } from "@/lib/account/devices";
import { authClient } from "@/lib/auth-client";
import { FormStatus, type Status, textButton } from "./controls";

const errorBody = z.object({ error: z.string() });

type Busy =
  | { kind: "device"; id: string }
  | { kind: "others" }
  | { kind: "here" }
  | null;

export function DeviceList({ devices }: { devices: AccountDevice[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [refreshing, startRefresh] = useTransition();
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [status, setStatus] = useState<Status | null>(null);
  const others = devices.filter((device) => !device.current).length;
  const locked = busy !== null || refreshing;

  // The list re-renders from the server, so the busy row stays marked until
  // the refreshed list replaces it.
  const settle = () =>
    startRefresh(() => {
      setBusy(null);
      router.refresh();
    });

  async function signOutDevice(id: string) {
    setBusy({ kind: "device", id });
    setRowError(null);
    setStatus(null);
    try {
      const response = await fetch(`/api/account/sessions/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = errorBody.safeParse(
          await response.json().catch(() => null),
        );
        setRowError({
          id,
          text: body.data?.error ?? "Couldn’t sign that device out.",
        });
        setBusy(null);
        return;
      }
      settle();
    } catch {
      setRowError({ id, text: "Couldn’t connect. Try again." });
      setBusy(null);
    }
  }

  async function signOutOthers() {
    setBusy({ kind: "others" });
    setRowError(null);
    setStatus(null);
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        setStatus({
          tone: "error",
          text: result.error.message ?? "Couldn’t sign out the other devices.",
        });
        setBusy(null);
        return;
      }
      setStatus({
        tone: "success",
        text:
          others === 1
            ? "Signed out of 1 other device."
            : `Signed out of ${others} other devices.`,
      });
      settle();
    } catch {
      setStatus({ tone: "error", text: "Couldn’t connect. Try again." });
      setBusy(null);
    }
  }

  async function signOutHere() {
    setBusy({ kind: "here" });
    setStatus(null);
    try {
      await authClient.signOut();
      settle();
    } catch {
      setStatus({ tone: "error", text: "Couldn’t connect. Try again." });
      setBusy(null);
    }
  }

  return (
    <div>
      <ul className="flex flex-col divide-y border-b md:-mt-3.5">
        {devices.map((device) => {
          const signingOut = device.current
            ? busy?.kind === "here"
            : busy?.kind === "others" ||
              (busy?.kind === "device" && busy.id === device.id);
          return (
            <li key={device.id} className="py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div id={`device-${device.id}`} className="min-w-0">
                  <p className="truncate text-[15px] font-medium">
                    {device.label}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {device.current ? (
                      <span className="text-foreground">This device</span>
                    ) : (
                      <time dateTime={device.lastActiveAt}>
                        {device.lastActive}
                      </time>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className={textButton}
                  disabled={locked}
                  aria-describedby={`device-${device.id}`}
                  onClick={() =>
                    void (device.current
                      ? signOutHere()
                      : signOutDevice(device.id))
                  }
                >
                  {signingOut
                    ? "Signing out…"
                    : device.current
                      ? "Sign out here"
                      : "Sign out"}
                </button>
              </div>
              {rowError?.id === device.id ? (
                <p role="alert" className="mt-1.5 text-sm text-destructive">
                  {rowError.text}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {others > 0 ? (
          <button
            type="button"
            className={textButton}
            disabled={locked}
            onClick={() => void signOutOthers()}
          >
            {busy?.kind === "others"
              ? "Signing out…"
              : "Sign out of all other devices"}
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">
            No other devices are signed in.
          </p>
        )}
        <FormStatus status={status} />
      </div>
    </div>
  );
}
