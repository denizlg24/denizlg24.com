import { Button } from "@repo/ui/button";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, native } from "./bridge";

const FIRST_CHECK_MS = 5_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UP_TO_DATE_MS = 3_000;

type Phase =
  | { name: "idle" }
  | { name: "checking"; manual: boolean }
  | { name: "current" }
  | { name: "available"; update: Update }
  | {
      name: "downloading";
      update: Update;
      received: number;
      total: number | null;
    }
  | { name: "ready"; version: string; hidden: boolean }
  | { name: "error"; message: string; update?: Update };

export function useUpdater() {
  const [version, setVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const lookForUpdate = useCallback(async (manual: boolean) => {
    const current = phaseRef.current.name;
    if (
      current === "checking" ||
      current === "downloading" ||
      current === "ready"
    )
      return;
    setPhase({ name: "checking", manual });
    try {
      const update = await check();
      if (update) setPhase({ name: "available", update });
      else setPhase(manual ? { name: "current" } : { name: "idle" });
    } catch (e) {
      setPhase(
        manual
          ? { name: "error", message: `Could not check for updates: ${e}` }
          : { name: "idle" },
      );
    }
  }, []);

  useEffect(() => {
    if (!native) return;
    getVersion().then(setVersion, () => setVersion(null));
    const first = setTimeout(() => void lookForUpdate(false), FIRST_CHECK_MS);
    const interval = setInterval(
      () => void lookForUpdate(false),
      CHECK_INTERVAL_MS,
    );
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [lookForUpdate]);

  useEffect(() => {
    if (phase.name !== "current") return;
    const timer = setTimeout(() => setPhase({ name: "idle" }), UP_TO_DATE_MS);
    return () => clearTimeout(timer);
  }, [phase.name]);

  const install = async (update: Update) => {
    setPhase({ name: "downloading", update, received: 0, total: null });
    try {
      let received = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null;
        else if (event.event === "Progress") received += event.data.chunkLength;
        setPhase({ name: "downloading", update, received, total });
      });
      setPhase({ name: "ready", version: update.version, hidden: false });
      void update.close();
    } catch (e) {
      setPhase({ name: "error", message: `Update failed: ${e}`, update });
    }
  };
  const dismiss = () => {
    const current = phaseRef.current;
    if (current.name === "ready") setPhase({ ...current, hidden: true });
    else {
      if (current.name === "available") void current.update.close();
      setPhase({ name: "idle" });
    }
  };
  const fromToolbar = () => {
    const current = phaseRef.current;
    if (current.name === "ready") setPhase({ ...current, hidden: false });
    else void lookForUpdate(true);
  };

  return { version, phase, fromToolbar, lookForUpdate, install, dismiss };
}

export function VersionButton({
  version,
  phase,
  onClick,
}: {
  version: string | null;
  phase: Phase;
  onClick: () => void;
}) {
  if (!version) return null;
  const label =
    phase.name === "checking" && phase.manual
      ? "Checking…"
      : phase.name === "current"
        ? "Up to date"
        : phase.name === "ready"
          ? `Restart for v${phase.version}`
          : `v${version}`;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="version-button"
      title={
        phase.name === "ready" ? "Show restart options" : "Check for updates"
      }
      disabled={phase.name === "checking" || phase.name === "downloading"}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function UpdateNotice({
  phase,
  liveAgents,
  onInstall,
  onDismiss,
  onRetry,
}: {
  phase: Phase;
  liveAgents: number;
  onInstall: (update: Update) => void;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const [restartError, setRestartError] = useState("");
  const dismissButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Dismiss update notice"
      onClick={onDismiss}
    >
      <X size={14} />
    </Button>
  );
  if (phase.name === "available")
    return (
      <div role="status" className="notice update-notice">
        <span>Agents {phase.update.version} is available.</span>
        <div>
          <Button size="sm" onClick={() => onInstall(phase.update)}>
            Download update
          </Button>
          {dismissButton}
        </div>
      </div>
    );
  if (phase.name === "downloading") {
    const percent =
      phase.total && phase.total > 0
        ? Math.min(100, Math.round((100 * phase.received) / phase.total))
        : null;
    return (
      <div role="status" className="notice update-notice">
        <span>
          Downloading Agents {phase.update.version}
          {percent === null ? "…" : ` · ${percent}%`}
        </span>
      </div>
    );
  }
  if (phase.name === "ready" && !phase.hidden)
    return (
      <div role="status" className="notice update-notice">
        <span>
          Agents {phase.version} is installed. Restart to finish updating.
          {liveAgents > 0 &&
            ` Restarting stops ${liveAgents} running ${liveAgents === 1 ? "agent" : "agents"}.`}
          {restartError && <span className="error-text"> {restartError}</span>}
        </span>
        <div>
          <Button
            size="sm"
            onClick={() =>
              api.restart().catch((e) => setRestartError(String(e)))
            }
          >
            Restart now
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Later
          </Button>
        </div>
      </div>
    );
  if (phase.name === "error")
    return (
      <div role="alert" className="notice error update-notice">
        <span>{phase.message}</span>
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (phase.update ? onInstall(phase.update) : onRetry())}
          >
            Retry
          </Button>
          {dismissButton}
        </div>
      </div>
    );
  return null;
}
