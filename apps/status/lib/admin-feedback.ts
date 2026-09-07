export type AdminResult = { ok: boolean; message: string };
export type AdminChange = {
  operation: string;
  id: string;
  fields: Record<string, string>;
};

export function pendingMessage(change: AdminChange) {
  const { operation, fields } = change;
  if (operation === "dr-command")
    return fields.action === "run"
      ? "Queueing backup…"
      : "Queueing schedule change…";
  return (
    (
      {
        "incident-create": "Publishing incident…",
        "incident-update": "Posting update…",
        "incident-acknowledge": "Acknowledging…",
        "incident-resolve": "Resolving…",
        "maintenance-save": "Saving maintenance…",
        "maintenance-cancel": "Cancelling maintenance…",
        "backup-run": "Queueing backup…",
        "backup-schedule": "Saving schedule…",
        "config-service": "Saving service…",
        "config-service-move": "Moving service…",
        "config-binding": "Saving binding…",
        "config-source-forget": "Forgetting source…",
        "sources-refresh": "Detecting sources…",
        "history-reset": "Clearing history…",
      } as Record<string, string>
    )[operation] ?? "Saving…"
  );
}

export function optimisticNote(change: AdminChange) {
  if (change.operation === "config-service")
    return change.fields.visible === "false"
      ? "Hidden · saving"
      : "Shown · saving";
  if (change.operation === "config-binding")
    return change.fields.kind === "ignore"
      ? "Not shown · saving"
      : change.fields.kind === "own"
        ? `Own tile · ${change.fields.name} · saving`
        : "Binding · saving";
  if (change.operation === "incident-update")
    return `${change.fields.state} · posting`;
  return pendingMessage(change);
}

export function optimisticOrder(ids: string[], changes: AdminChange[]) {
  const result = [...ids];
  for (const change of changes) {
    if (change.operation !== "config-service-move") continue;
    const from = result.indexOf(change.id);
    const to = from + (change.fields.direction === "up" ? -1 : 1);
    if (from >= 0 && to >= 0 && to < result.length)
      [result[from], result[to]] = [result[to]!, result[from]!];
  }
  return result;
}
