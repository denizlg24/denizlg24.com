import type { Agent } from "./types";
import { count } from "./types";
export function Usage({ agent: a }: { agent: Agent }) {
  const context =
    a.contextTokens !== null && a.contextWindow
      ? Math.min(100, (100 * a.contextTokens) / a.contextWindow)
      : null;
  return (
    <section className="usage" aria-label="Usage">
      <dl>
        <div>
          <dt>Input</dt>
          <dd>{count(a.inputTokens)}</dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>{count(a.outputTokens)}</dd>
        </div>
        <div>
          <dt>Cached</dt>
          <dd>{count(a.cachedTokens)}</dd>
        </div>
        {a.cost !== null && (
          <div>
            <dt>Cost</dt>
            <dd>${a.cost.toFixed(3)}</dd>
          </div>
        )}
      </dl>
      {context !== null && (
        <div className="usage-window">
          <span>
            Context <b>{context.toFixed(0)}%</b>
          </span>
          <meter min={0} max={100} value={context} />
        </div>
      )}
      {a.rateLimits &&
        Object.entries(a.rateLimits)
          .filter(([, v]) => v && typeof v.used_percent === "number")
          .map(([key, v]) => (
            <div className="usage-window" key={key}>
              <span>
                {v.window_minutes
                  ? `${v.window_minutes >= 1440 ? `${Math.round(v.window_minutes / 1440)}d` : `${v.window_minutes / 60}h`} limit`
                  : key}{" "}
                <b>{v.used_percent?.toFixed(0)}% used</b>
              </span>
              <meter min={0} max={100} value={v.used_percent} />
              {v.resets_at && (
                <small>
                  Resets{" "}
                  {new Date(v.resets_at * 1000).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              )}
            </div>
          ))}
      {a.inputTokens === null && <p className="muted">Usage pending</p>}
      {a.telemetryError && <p role="alert">{a.telemetryError}</p>}
    </section>
  );
}
