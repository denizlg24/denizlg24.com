# Infrastructure

This directory holds the deployment definitions for the self-hosted cloud: the
Raspberry Pi that runs the API, databases and storage, and the host units that
support it. It documents what runs and how the pieces are arranged; the
operating procedures and the private environment files live outside the
repository.

The stack is live. `api.denizlg24.com` is served from the Pi behind a
Cloudflare tunnel; the cloud, storage and deployment dashboards run on Forge
from their own container images.

## Layout

| Path | Contents |
| --- | --- |
| `compose/` | Production compose files, environment examples, database entrypoints |
| `systemd/` | Terminal, reboot sentinel, DDNS, certificate renewal and health-check units |
| `scripts/` | Host install, DDNS and TLS helpers, and the migration safety tooling |
| `network/`, `fail2ban/` | Firewall rules, Cloudflare Tunnel config, database and SSH jails |
| `tailscale/` | Private management network configuration |
| `dr/` | The [disaster-recovery system](dr/README.md) |
| `forge/` | The [Forge host](forge/README.md) definitions |

A copy of this tree is deployed on the Pi. The production environment file
exists only there, and only the container image ships through continuous
integration — compose changes are a separate deployment step, which is the most
common way for the host to end up running a definition that no longer matches
this directory.

## How a deploy works

Pushing to the default branch builds an arm64 image and publishes it to the
container registry. The host then pulls and recreates the affected services.
Compose files are validated against the example environment before deployment,
so a syntax or interpolation error is caught in the repository rather than on
the host.

Rollback re-runs the release with a known-good image tag. Bind mounts are
untouched by that path, which is what makes it non-destructive and why images
and volumes are left alone while a failed deploy is being diagnosed.

**A healthy container is not a ready one.** The runtime is constructed lazily on
the first API request, and the health endpoint sits outside the API prefix. A
container can therefore report healthy having seeded no scheduled tasks,
reconciled no cache ACLs and started no workers. Readiness is confirmed by an
authenticated request reaching the API and by the scheduled-task table holding
the expected schedules — not by the container's own health status.

## Host services

Some things deliberately do not run in containers.

**The terminal daemon** is a compiled binary installed on the host and is not
shipped by continuous integration, so it is replaced by hand and a code change
is not live until that happens. It runs as root because it is the primary
remote administration path, which the daemon refuses to do without an explicit
opt-in in its unit; it still rejects wildcard and publicly routable binds. Its
process-scoped kill mode keeps the multiplexer server alive across daemon
restarts, and sessions are reaped after an idle period.

The API reaches it over the host's tailnet address rather than the container
bridge gateway: Docker's inter-bridge isolation makes that gateway unroutable
from the compose network, and the host firewall's default-deny input policy
requires an explicit rule for the container subnets in any case.

**The reboot sentinel** is a file the API writes and a host path unit consumes,
so a container never holds the ability to reboot the machine directly. The
directory it writes into must be owned by the same unprivileged user the
container runs as, or every reboot request fails on permissions.

**Docker access** is only ever through a proxy that permits container list,
inspect, stats, exec and restart — no images, networks, volumes or secrets. The
proxy cannot run with a read-only root filesystem because it renders its own
configuration at start, and a temporary filesystem over that directory would
hide the template.

**The MongoDB keyfile** is host-owned and read-only to root, and must match the
data directory's replica set or the daemon will not start.

**Storage files must be owned by the API's unprivileged user.** Anything written
as root makes deletes, renames and uploads fail with permission errors while
reads keep working, which makes the failure look like an application bug rather
than an ownership one.

## Memory

The Pi has just under 4 GB, and the full stack sits at roughly 1.5 GB in steady
state. The API is capped at 1200 MiB; everything else runs uncapped but
internally bounded through its own configuration — PostgreSQL shared buffers,
the MongoDB storage-engine cache, the search process heap, and the Redis memory
ceiling.

Bun is the only genuinely unbounded runtime here, which is why it is the one
carrying a cgroup limit. An unbounded response buffer previously triggered a
global out-of-memory condition in which the kernel chose Redis as its victim —
the failure appeared in a service that had done nothing wrong.

Out-of-memory score adjustments bias the killer away from data and toward
replaceable processes: negative on the databases, positive on the API, highest
on sidecars and tools.

The PostgreSQL connection ceiling is shared between the API's pool and every
dependent project connecting directly. Each backend costs several megabytes, so
a saturated ceiling is a commitment of most of a gigabyte. The intended answer
to growth there is a connection pooler in transaction mode, not a higher
ceiling. The planner's cache-size setting allocates nothing and is tuned
independently of that budget.

## Migration safety tooling

`scripts/` contains the tooling built for the POSIX storage migration. It is
recorded here because the safety properties are the interesting part.

The pre-migration snapshot is deliberately separate from the scheduled
database backups. It freezes and archives both physical storage branches,
including the object-storage and upload internals, and captures the databases
and the cache ACL file, preserving extended attributes, POSIX ACLs, sparse
allocation, ownership, modes and timestamps. It records content and tree
manifests and only the deployed image identifiers — container environments and
their secrets are never copied into evidence. By default it refuses to run
while the API is live; an explicit exception records itself in the manifest
rather than being silent, and the archive still fails verification if namespace
bytes change during capture.

The matching verifier restores into disposable loopback filesystems and
isolated database containers with networking disabled, compares the restored
trees and every file checksum, writes a proof document, then removes its own
mounts, loop devices, containers and volumes. Because the completed snapshot
contains database role hashes and the cache ACL, it is private rollback
material rather than a backup artifact.

The Samba and mergerfs spike never mounts a production branch. It builds sparse
loopback images, joins only those with mergerfs, and starts an isolated file
server. Samba cannot restrict itself to the tailnet interface directly, because
that interface is a non-broadcast tunnel device, so a dedicated firewall chain
rejects the SMB port unless the connection arrived on it, with a narrow
loopback exception for encrypted health checks. The firewall is installed
before the file server, retained until listener withdrawal is proven, and
removed on verified failure or teardown. The production units stay masked
throughout.

Every gate in that spike is fail-closed and reports partial results honestly:
distinct exit codes separate "safely withdrawn, or a required stop remains"
from "fail-closed behaviour could not be proven", a reboot check stays
quarantined until the loopback branches are remounted and their markers
verified rather than inferring preservation from absence, and the checks report
an explicit failed overall result so that no subset of them can be mistaken for
having passed the gate. The adversarial extended-attribute probe is separate
for the same reason: an accepted reserved stream name is a failure even when
the file server stores it under an alias instead of overwriting the protected
attribute.

## Tools

The database administration interfaces run in an optional profile, bound to
loopback only, and are reached through the admin application's authenticated
proxy. They are never published.

## Health

The public health endpoint returns a JSON status, alongside TCP checks on the
public database hostnames.

Component detail is available to an authenticated superuser session and covers
PostgreSQL, MongoDB, Redis, search, disk and the tunnel. The website's
dependency sub-resources use a deep-health endpoint with a named, encrypted
credential and per-component JSON assertions, matching what the external
monitoring provider checks, while the public aggregate and remaining service
checks continue alongside it. Credentials never appear in a check URL. See
[resource monitoring](../docs/dr/README.md#resource-monitoring) for how those
sources fit together.
