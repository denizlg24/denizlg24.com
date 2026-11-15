import { useEffect, useState } from "react";
import { api } from "./bridge";

export function GitPanel({ id, open }: { id: string; open: boolean }) {
  const [state, setState] = useState<{
    status: string;
    recentCommits: string;
    diffStat: string;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api.git(id);
        if (!cancelled) {
          setState(next);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
      if (!cancelled) timer = setTimeout(refresh, 5000);
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, open]);
  return (
    <section className="git-panel" aria-label="Git operations">
      {error ? (
        <p role="status">{error}</p>
      ) : state ? (
        <>
          <pre>{state.status}</pre>
          {state.diffStat && <pre>{state.diffStat}</pre>}
          {state.recentCommits && (
            <>
              <h3>Recent commits</h3>
              <pre>{state.recentCommits}</pre>
            </>
          )}
        </>
      ) : (
        <p role="status">Loading Git status…</p>
      )}
    </section>
  );
}
