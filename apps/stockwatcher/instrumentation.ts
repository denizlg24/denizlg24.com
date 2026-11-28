export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { jobsEnabled } = await import("./lib/jobs/client");
  if (jobsEnabled()) return;
  if (process.env.BROKER_SYNC !== "0") {
    const { syncDueLinks } = await import("./lib/brokers/sync");
    const sync = () =>
      void syncDueLinks().catch(() => console.error("Broker sync failed"));
    setTimeout(sync, 30_000).unref();
    setInterval(sync, 30 * 60_000).unref();
  }
  const { purgeExpiredRuns } = await import("./lib/run-retention");
  const purge = () =>
    void purgeExpiredRuns().catch(() =>
      console.error("Chat run retention purge failed"),
    );
  setTimeout(purge, 60_000).unref();
  setInterval(purge, 6 * 60 * 60_000).unref();
  if (process.env.ALERT_MONITOR !== "1") return;
  if (process.env.ALT_WARM !== "0") {
    const { altWarmers } = await import("./lib/alt/registry");
    for (const warmer of altWarmers) {
      const warm = () =>
        void Promise.resolve(warmer.run()).catch(() =>
          console.error(`Alt data refresh failed: ${warmer.name}`),
        );
      setTimeout(warm, 20_000 + Math.random() * 40_000).unref();
      setInterval(warm, warmer.everyMs).unref();
    }
  }
  const { monitorRoutines } = await import("./lib/routine-runner");
  const routines = () =>
    void monitorRoutines().catch(() => console.error("Routine check failed"));
  setTimeout(routines, 45_000).unref();
  setInterval(routines, 5 * 60_000).unref();
  const { monitorAlerts } = await import("./lib/alert-monitor");
  const run = () =>
    void monitorAlerts().catch(() => console.error("Price alert check failed"));
  setTimeout(run, 10_000).unref();
  setInterval(run, 120_000).unref();
}
