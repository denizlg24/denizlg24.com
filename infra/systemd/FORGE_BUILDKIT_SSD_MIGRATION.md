# Forge BuildKit SSD migration

This migration moves only BuildKit's hot content store and snapshots to the
SSD. Repository checkouts, logs, and other durable project data remain under
`/mnt/storage/forge` on the HDD. Docker runtime images remain in
`/var/lib/docker` on the SSD.

The SSD profile targets a 70 GB steady-state cache and preserves 55 GB free.
BuildKit GC limits are not filesystem quotas, so an active build can briefly
exceed the target. The migration refuses to start unless the SSD has at least
100 GB available.

## Before the maintenance window

Deploy the accompanying agent change first. It understands
`SERIALIZE_BUN_INSTALLS=false`, waits for the Forge queue to drain before an
agent restart, and no longer restarts an unchanged BuildKit worker on every
release. The host stays on the HDD profile after that deployment.

Bootstrap the guarded installer before approving that first release, because
the currently installed copy is the process that would otherwise perform the
first restart:

```bash
scp infra/systemd/forge-agent-install forge:/tmp/forge-agent-install
ssh -t forge \
  'sudo install -o root -g root -m 0755 /tmp/forge-agent-install /usr/local/sbin/forge-agent-install'
```

After this one non-restarting install, agent releases fail safely if a build or
post-build deployment is active. Wait for the queue to become idle and rerun
the approved workflow; do not restart either service by hand to make the
deployment pass.

## Stage the migration bundle

From the repository root on the laptop:

```bash
ssh forge 'mkdir -p /tmp/forge-buildkit-ssd-migration'
scp \
  scripts/forge-buildkit-ssd-migrate.sh \
  infra/systemd/forge-buildkit.service \
  infra/systemd/forge-buildkitd-ssd.toml \
  forge:/tmp/forge-buildkit-ssd-migration/
```

Inspect the live profile without changing it:

```bash
ssh -t forge \
  'sudo /tmp/forge-buildkit-ssd-migration/forge-buildkit-ssd-migrate.sh status'
```

Expected before migration:

- BuildKit mount source: `/mnt/storage/forge/buildkit`
- `BUILDX_BUILDER=forge-hdd`
- `SERIALIZE_BUN_INSTALLS=true` or absent
- SSD available space: at least 100 GB
- Forge queue: zero running and zero building

## Apply

```bash
ssh -t forge \
  'sudo /tmp/forge-buildkit-ssd-migration/forge-buildkit-ssd-migrate.sh apply'
```

The script performs these operations as one guarded switch:

1. Verifies the new agent is installed, both disks are mounted, the queue is
   idle, no build process remains, and SSD headroom is sufficient.
2. Saves the current unit, HDD BuildKit config, agent environment, and storage
   override in `/var/lib/forge-agent/ssd-migration-backup`.
3. Stops the agent before the worker so no new deployment can be claimed.
4. Starts BuildKit with an empty `/var/lib/forge-buildkit` cache and the bounded
   SSD GC profile.
5. Changes the agent to two build slots, `forge-ssd`, and concurrent Bun cache
   mounts.
6. Confirms the live container actually mounted the SSD path before restarting
   the agent.
7. Automatically restores the HDD profile if startup or health validation
   fails.

The existing HDD cache is never copied or deleted. The first SSD build is
therefore cold, but it avoids migrating roughly 150 GB of stale cache and keeps
rollback immediate.

## Validate

Start with one small deployment, then rebuild `apps/web`. During the web build,
check:

```bash
ssh forge 'cat /proc/pressure/io'
ssh -t forge 'sudo docker exec forge-buildkit buildctl du | tail -n 20'
ssh -t forge \
  'sudo docker inspect forge-buildkit --format="{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}"'
```

The BuildKit mount must be `/var/lib/forge-buildkit -> /var/lib/buildkit`.
Compare the `bun install`, `exporting layers`, and `sending tarball` durations
against the pre-migration web build, where install took about 24 minutes and
layer export took about 31 minutes. Do not judge the cache hit rate from the
first build; use a second build of the same target.

## Roll back

Rollback is also queue-gated:

```bash
ssh -t forge \
  'sudo /tmp/forge-buildkit-ssd-migration/forge-buildkit-ssd-migrate.sh rollback'
```

This restores the original service, agent environment, and HDD configuration.
It leaves the SSD cache intact for inspection.

## After validation

Keep `/mnt/storage/forge/buildkit` unchanged for several successful production
builds. Reclaiming it is a separate destructive operation and is deliberately
not part of this script. Confirm the live mount and the rollback decision before
removing any old cache data.

`/etc/forge/buildkit-storage.env` is host-local and is not overwritten by the
normal agent release workflow. Future releases will therefore continue using
the SSD profile while still updating the generic service definition safely.
