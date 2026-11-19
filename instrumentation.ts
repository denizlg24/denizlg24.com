export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.ALERT_MONITOR !== "1"
  )
    return;
  const { monitorAlerts } = await import("./lib/alert-monitor");
  const run = () =>
    void monitorAlerts().catch(() => console.error("Price alert check failed"));
  setTimeout(run, 10_000).unref();
  setInterval(run, 120_000).unref();
}
