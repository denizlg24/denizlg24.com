import "server-only";
import { alertWorkspaces, saveWorkspace } from "./db";
import { quotes } from "./market";

let running = false;

export async function monitorAlerts() {
  if (running) return;
  running = true;
  try {
    const workspaces = await alertWorkspaces();
    const symbols = [
      ...new Set(
        workspaces.flatMap(({ data }) =>
          data.alerts.filter((item) => item.enabled).map((item) => item.symbol),
        ),
      ),
    ];
    if (!symbols.length) return;
    const data = new Map(
      (await quotes(symbols)).map((item) => [item.symbol, item]),
    );
    for (const { id, revision, data: workspace } of workspaces) {
      let changed = false;
      for (const alert of workspace.alerts) {
        if (!alert.enabled) continue;
        const quote = data.get(alert.symbol);
        if (!quote || Date.now() - quote.time * 1000 > 96 * 60 * 60 * 1000)
          continue;
        const hit =
          alert.direction === "above"
            ? quote.price >= alert.target
            : quote.price <= alert.target;
        if (!hit) continue;
        alert.enabled = false;
        alert.lastTriggered = new Date().toISOString();
        alert.triggeredPrice = quote.price;
        changed = true;
      }
      if (changed) await saveWorkspace(id, revision, workspace);
    }
  } finally {
    running = false;
  }
}
