import { Button } from "@repo/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import {
  ArrowUpRight,
  Brain,
  FolderOpen,
  GitBranch,
  Shield,
  ShieldOff,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./bridge";
import type { LaunchOptions, ModelOption, Provider } from "./types";

const defaults: LaunchOptions = {
  model: "",
  reasoning: "",
  permissions: "default",
};
const catalog = new Map<Provider, Promise<ModelOption[]>>();
export function LaunchDialog({
  provider,
  onProvider,
  providers,
  busy,
  error,
  onClose,
  onLaunch,
}: {
  provider: Provider;
  onProvider: (p: Provider) => void;
  providers: Record<Provider, boolean>;
  busy: boolean;
  error: string;
  onClose: () => void;
  onLaunch: (cwd: string, options: LaunchOptions) => void;
}) {
  const [cwd, setCwd] = useState("");
  const [options, setOptions] = useState<LaunchOptions>(defaults);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [directoryError, setDirectoryError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setOptions(defaults);
    setModels([]);
    setModelError("");
    if (!providers[provider]) return;
    setLoading(true);
    let request = catalog.get(provider);
    if (!request) {
      request = api.models(provider);
      catalog.set(provider, request);
    }
    request
      .then((list) => {
        if (!cancelled) setModels(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        catalog.delete(provider);
        if (!cancelled)
          setModelError(
            "Model list unavailable. Use CLI default or enter a model ID.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, providers]);
  const selected = models.find((m) => m.id === options.model);
  const efforts = selected?.reasoning?.length
    ? selected.reasoning
    : provider === "claude"
      ? ["low", "medium", "high", "xhigh", "max"]
      : Array.from(new Set(models.flatMap((m) => m.reasoning))).length
        ? Array.from(new Set(models.flatMap((m) => m.reasoning)))
        : ["low", "medium", "high", "xhigh"];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="launch-dialog" aria-describedby={undefined}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (cwd.trim() && !busy && providers[provider])
              onLaunch(cwd.trim(), options);
          }}
        >
          <div className="launch-heading">
            <div className="launch-glyph">
              <TerminalSquare size={24} />
            </div>
            <DialogTitle>Launch an agent</DialogTitle>
            <span className="launch-subtitle">Your workspace. Your CLI.</span>
          </div>
          <div
            className="launch-provider"
            role="group"
            aria-label="CLI provider"
          >
            {(["codex", "claude"] as const).map((p) => (
              <button
                type="button"
                key={p}
                aria-pressed={provider === p}
                onClick={() => onProvider(p)}
                disabled={busy}
              >
                {p === "codex" ? (
                  <TerminalSquare size={19} />
                ) : (
                  <GitBranch size={19} />
                )}
                <span>
                  {p === "codex" ? "Codex" : "Claude"}
                  {!providers[p] && <small>Not installed</small>}
                </span>
              </button>
            ))}
          </div>
          <div className="launch-directory">
            <FolderOpen size={19} />
            <input
              id="directory"
              aria-label="Working directory"
              placeholder="Choose your working directory"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={async () => {
                try {
                  const dir = await api.directory();
                  if (typeof dir === "string") setCwd(dir);
                } catch (e) {
                  setDirectoryError(String(e));
                }
              }}
            >
              Choose
            </Button>
          </div>
          <div className="launch-config">
            <label>
              <span>
                <TerminalSquare size={14} />
                Model
              </span>
              <input
                aria-label="Model"
                list="agent-models"
                placeholder={loading ? "Loading models…" : "CLI default"}
                value={options.model}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    model: e.target.value,
                    reasoning: "",
                  }))
                }
                disabled={busy}
              />
              <datalist id="agent-models">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </datalist>
            </label>
            <label>
              <span>
                <Brain size={14} />
                Reasoning
              </span>
              <select
                aria-label="Reasoning"
                value={options.reasoning}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, reasoning: e.target.value }))
                }
                disabled={busy}
              >
                <option value="">CLI default</option>
                {efforts.map((e) => (
                  <option key={e} value={e}>
                    {e === "xhigh"
                      ? "Extra high"
                      : e.charAt(0).toUpperCase() + e.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {modelError && <p className="launch-hint">{modelError}</p>}
          <fieldset className="launch-permissions">
            <legend>Permissions</legend>
            <div>
              {(
                [
                  {
                    value: "default",
                    title: "CLI default",
                    detail: "Use your existing settings",
                    icon: Shield,
                  },
                  {
                    value: "read-only",
                    title: provider === "claude" ? "Plan mode" : "Read-only",
                    detail: "Inspect before making changes",
                    icon: Shield,
                  },
                  {
                    value: "bypass",
                    title: provider === "codex" ? "YOLO" : "Bypass permissions",
                    detail:
                      provider === "codex"
                        ? "Skip approvals and sandbox"
                        : "Skip permission checks",
                    icon: ShieldOff,
                  },
                ] as const
              ).map((mode) => (
                <label
                  key={mode.value}
                  className={options.permissions === mode.value ? "chosen" : ""}
                >
                  <input
                    type="radio"
                    name="permissions"
                    value={mode.value}
                    checked={options.permissions === mode.value}
                    onChange={() =>
                      setOptions((o) => ({ ...o, permissions: mode.value }))
                    }
                    disabled={busy}
                  />
                  <mode.icon size={16} />
                  <span>
                    <strong>{mode.title}</strong>
                    <small>{mode.detail}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {(error || directoryError) && (
            <p role="alert" className="error-text">
              {error || directoryError}
            </p>
          )}
          <footer className="launch-footer">
            <span>
              {provider === "codex" ? "Codex CLI" : "Claude Code"}
              <span className="launch-local">Local session</span>
            </span>
            <Button
              type="submit"
              disabled={!cwd.trim() || !providers[provider] || busy}
            >
              {busy ? "Launching…" : "Launch agent"}
              <ArrowUpRight size={15} />
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
