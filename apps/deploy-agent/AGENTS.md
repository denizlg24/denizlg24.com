# apps/deploy-agent — the Forge host

## Host behaviour

- **One live Forge deployment without a recovery image stops every DR backup
  on both hosts.** Forge's backup refuses an inventory with an unrecoverable
  image and the Pi's refuses a control-plane row without a GHCR digest, so
  nothing is captured until it is fixed. The deploy pipeline treats a failed
  push as non-fatal (the site is already serving) and nothing used to retry it:
  eleven pushes sharing the uplink after one monorepo-wide deploy on 2026-09-17
  all timed out, and backups stayed down for five days. The agent now pushes one
  at a time (`createSerialQueue`), and `forge_recovery_publish` (every 30 min)
  republishes whatever is still missing through the agent's `publish-recovery`,
  which no longer holds the host lock through an upload. Its failed run names
  the deployment; so do both backup STOPs.
- **Forge's board halts instead of resetting after a clean shutdown.** The
  journal shows userspace finishing in seconds; the MSI Z370 then never
  resets, and every `sudo reboot` needed someone at the power button. The
  safety net is the Intel TCO watchdog, and it takes three pieces:
  `forge-watchdog.service` (an explicit `modprobe`, because Ubuntu deny-lists
  `iTCO_wdt` and `systemd-modules-load` honours that), `RebootWatchdogSec=3min`,
  and `watchdog.stop_on_reboot=0` on the kernel command line, since the driver
  otherwise asks the reboot notifier to disarm it right before the step that
  hangs. `reboot=pci` rides along as the likelier clean fix. All of it arrives
  through `forge-agent-install` and only applies from the next boot, so the
  first reboot after it lands still needs watching.
- **The weekly Forge reboot is seeded disabled.** `forge_reboot` asks the
  agent to drain its queue and then its recovery pushes, refusing new
  republishes with a 503 meanwhile (`POST /host/reboot`); the agent writes
  `/srv/forge/host-control/reboot-requested`, and `forge-reboot.path` runs
  `/usr/local/sbin/forge-reboot` as root, which waits up to 30 min for the DR
  host lock, keeps it, and reboots. Arm it only after a watched reboot has come
  back on its own, and add the status-page maintenance window for Forge's
  services at the same time, or every Forge app opens an incident each Sunday.
- **DR host locks that outlive their holder are reclaimed, not reviewed.**
  `/etc/tmpfiles.d/deniz-dr-locks.conf` removes every
  `/var/lib/deniz-dr/locks/*.lock` at boot, before anything can take one, and
  `dr_reclaim_abandoned_lock` breaks one whose pid no longer exists in `/proc`
  (`kill -0` cannot tell another user's live process from a dead one). Locks
  that record only an owner (the Mac bridge, release workflows) are still left
  alone. The Pi's copy of the tmpfiles rule is installed by `install-host`,
  which no release runs, so a change to it needs that run by hand.
- **A Forge target's `cpuLimit` is a burst ceiling, not an allocation.**
  Contention is settled by weight: every deployment runs under
  `forge-apps.slice` (`--cgroup-parent`; `CPUWeight=200`, capped at ten of the
  twelve threads) with `--cpu-shares` by kind — production 1024, environment
  512, preview 256 — and BuildKit runs at `--cpu-shares 102` inside
  `system.slice`. The default ceiling is `DEFAULT_CPU_LIMIT` (10); the agent
  clamps anything higher to the host's threads minus two. A hard one-core quota
  used to throttle web's image optimizer on a host sitting at 7%. The slice
  unit ships with the agent, but the release runs the *previously installed*
  `forge-agent-install`, so a new staged unit lands one release late unless
  installed by hand; without it systemd still creates the slice, uncapped.
- **Stateful services on the Forge box are host units, never deployments.** A
  Forge deployment gets no volume (old containers go with `--volumes`), an
  HTTP-only health check and a new port and container name on every deploy, so
  a Redis deployed as an app would come back empty. `forge-redis-install
  <instance> <cache|durable> <maxmemory-mb>` (in `infra/systemd`, installed to
  `/usr/local/sbin`, run by hand; no release ships it) writes
  `/etc/forge/redis/<instance>.{conf,env}`, data under `/srv/forge/redis/<instance>`
  owned by the `forge-redis` system user, and enables `forge-redis@<instance>`.
  Re-running keeps the password. `durable` means `noeviction` + AOF everysec:
  the Pi's shared Redis is `allkeys-lru`, which would silently drop stream
  entries and queued jobs. Apps connect with
  `redis://default:<requirepass>@forge-redis-<instance>:6379` from `forge-apps`.
  Only `shortn-durable`'s data is in the DR allowlist; caches are rebuildable.
