export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.BROKER_SYNC !== "0") {
    const { syncDueLinks } = await import("./lib/brokers/sync");
    const sync = () =>
      void syncDueLinks().catch(() => console.error("Broker sync failed"));
    setTimeout(sync, 30_000).unref();
    setInterval(sync, 30 * 60_000).unref();
  }
  if (process.env.ALERT_MONITOR !== "1") return;
  const { monitorAlerts } = await import("./lib/alert-monitor");
  const run = () =>
    void monitorAlerts().catch(() => console.error("Price alert check failed"));
  setTimeout(run, 10_000).unref();
  setInterval(run, 120_000).unref();
}
