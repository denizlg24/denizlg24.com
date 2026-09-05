# Disaster recovery implementation

This directory holds the disaster-recovery system for the two hosts that carry
denizlg24.com: the Raspberry Pi running the cloud API, databases and storage
namespace, and the Forge host that builds and runs the application deployments.

[docs/dr](../../docs/dr/README.md) describes what is protected, how the backup
and recovery flow fits together and what the retention policy keeps. This page
describes how the implementation is organised and which properties it is built
to hold. The operating procedures themselves are private.

## Design

The system is fail-closed. No public record changes until encrypted backup
objects, signatures, snapshot age, target capacity, database semantics,
namespace metadata, immutable images, local services, source fencing and the
reviewed Cloudflare base have all passed. A check that cannot be evaluated
counts as a failure, not as a pass.

Two hosts are treated as independent profiles throughout. They hold separate
restic repositories, separate encryption passwords, separate signing keys and
separate active-site leases, so either can be recovered without the other and
a partial recovery never interrupts the surviving side.

## Layout

| Path | Contents |
| --- | --- |
| `backup` | Per-host capture, verification and signed publication |
| `r2-sync`, `r2-retention` | Offsite copy to Cloudflare R2 and its guarded retention pass |
| `recover`, `remote/` | Preflight, target bootstrap and per-profile restore |
| `cutover`, `rollback` | Public traffic and backup-ownership transfer, and its reverse |
| `rehearse` | The two live rehearsal exercises and their signed evidence |
| `macos/` | The optional Mac bridge that mirrors repositories into iCloud |
| `opentofu/` | Reviewed DNS, tailnet policy and monitoring contracts |
| `schemas/` | JSON schemas for manifests, evidence and recovery reports |
| `config/` | Capture allowlists and the recovery package baseline |
| `lib/`, `tests/` | Shared logic and the offline test suite |
| `*.example.env`, `*.example.json` | Shapes of the private files, with no values |

Every file here is configuration-free. Host environments, credentials and the
break-glass inventory live outside the repository on the machines that need
them.

## What a successful backup means

A Pi backup runs daily, timed to clear the namespace checksum and tiering
passes, either of which would rewrite the namespace underneath the archive and
trip its own consistency check. Forge backs up every six hours.

A success is not "the command exited zero". It means each PostgreSQL database
was dumped from an exported repeatable-read snapshot with global role and
database state unchanged; PostgreSQL, MongoDB and Redis artifacts were restored
into network-isolated containers created from the exact live image IDs and
compared semantically, with Redis evidence including absolute expirations; the
filesystem transaction covered both namespace branches and the separate
authoritative project object tree, limited to the exact manifest path set with
before-and-after inventories; and restic backup, prune and check, signed
publication and group-readable immutable repository state all completed.

Partial uploads and generated archives are treated as disposable rather than
protected state. Continuous integration additionally restores a synthetic
three-tree snapshot and compares ACLs, extended attributes, sparse extents,
ownership, modes, timestamps, counts and full hashes.

Failure calls the monitoring heartbeat's failure endpoint immediately rather
than waiting for a missed schedule.

## Offsite copies

There are two tiers on deliberately independent providers.

**Cloudflare R2 is the bulk offsite.** An hourly service copies any snapshot
present in the local repository but absent from the bucket, then publishes that
snapshot's signed completion manifest and signature. It is idempotent: lock
contention skips the cycle and any other failure exits nonzero, fails the R2
heartbeat and is retried on the next tick. Copy and retention are separate
commands; retention independently verifies the R2 repository before applying
its guarded policy.

**iCloud is an optional independent copy.** The Mac bridge copies full
encrypted repositories, including the namespace, and requires a signed-in Apple
device and a confirmed File Provider upload. It is a second provider rather
than the primary path.

The local repository sits on the machine it protects, so publishing to it is
staging, not backup. A snapshot is offsite only once the copy has run **and**
the restic snapshot object exists in the bucket — restic writes that object
last, so its presence is what distinguishes a finished copy from a partial one.

Retention keeps the latest three snapshots, every snapshot within 14 days, 90
daily points and 12 monthly points, grouped by host. It reads only R2's own
inventory, protects recent and last-good copies, limits deletion to a quarter
of the snapshots per pass, checks the repository before and after pruning, and
retires obsolete signed manifests last. Failed or overdue retention prevents
the next copy from clearing the shared alert, so a later upload cannot mask it.
The [full policy and guards](../../docs/dr/README.md#retention) are documented
alongside the reasoning.

## Recovery

Recovery reads from either offsite source. R2 is read in place: no hydration,
no locally staged copy of the repository and no dependency on iCloud being
healthy or even signed in. Both sources verify the same signed manifest against
the same allowed-signers file before trusting anything, and the R2 path
additionally asserts that the restic snapshot object is present, since a signed
manifest proves a backup completed while only that object proves the copy did.
A combined recovery resolves its Pi and Forge pair by matching control-plane
digests and stops outright if no compatible pair exists.

Three modes sit at different costs:

- **Plan and simulate** read only R2 metadata and print a recovery plan with no
  server, no repository hydration, no payload restore and no break-glass
  secrets. They authenticate the same signed catalog as a real recovery and
  report compatibility blockers and required target capacity. They are not live
  restore proof, and the reports say so in their own fields. See
  [recovery without a VPS](../../docs/dr/README.md#recovery-without-a-vps-or-large-local-disk).
- **Preflight** performs hydration, signature and checksum verification, restic
  verification, and age and capacity calculation without contacting a target.
  Capacity comes from the signed expanded restore footprint measured during the
  disposable database restores, the namespace allocation inventory, Redis memory
  evidence and uncompressed configuration archives; compressed backup bytes are
  reported separately and never stand in for restored bytes.
- **Full recovery** bootstraps and verifies a real target, optionally stopping
  before any public change.

A recovery point older than 24 hours stops after printing its age; proceeding
requires an explicit flag and an interactive confirmation. Every snapshot binds
a checksum of the validated version lock and the exact host package inventory,
and the package baseline resolves the reviewed source versions into one exact
target baseline; any unreviewed version or unresolved conflict stops recovery
rather than guessing. Source hosts are never upgraded to make a recovery fit.

Pi recovery imports the encrypted Samba password hashes and route inventory,
replaces the empty Redis bootstrap file with the signed database, and verifies
database semantics and storage metadata before dependent services start. Forge
recovery stores each deployment's resolved environment as authenticated
ciphertext inside the signed snapshot; the restored API exposes that plaintext
only through an in-memory expiring override that the recovery agent consumes
immediately before launch and then deletes, so recovery does not depend on the
secrets service being available and a mismatch is refused without exposing
anything in manifests, reports or request bodies.

Bootstrap records the target's tailnet address and closes public SSH, and all
later restore, cutover and rollback traffic uses that authenticated private
path. The public address remains only the target's identity and DNS
destination. Plaintext staging is deleted after a verified restore. Rerunning
the same target, profile and snapshot resumes only compatible checkpoints:
time-dependent inputs may refresh, but changed signed evidence cannot reuse one.

## Cutover and rollback

Cutover requires every selected source endpoint to be reachable. It stops the
source's backup jobs, writers and tunnel, atomically repoints the Mac bridge
route at the target using the report's pinned host key, changes only the
selected profile's active-site lease, then enables the target's backup and
heartbeat timers. For Forge, the reviewed external-state file must contain a
DNS mutation and an external health URL for every domain in the signed restore
inventory — a representative dashboard cannot stand in for the recovered
applications.

There is no override for an unreachable source. Recovery may still be verified,
but public mutation stops until the source can be authoritatively fenced.

Rollback reverses those steps and removes the bridge override only after the
home host passes local service, metadata-socket and authenticated deep checks,
every fenced container and hostname passes through the local proxy, and the
home lease and source timers are healthy. The lease check that runs at the
start and end of every backup is what prevents either side from publishing a
completion record while it is not authoritative, without interrupting the
unaffected profile during a partial recovery.

## Rehearsals and readiness

Two live rehearsals exist. The first runs recovery on a clean private server
with signed evidence that both online source hosts and their public endpoints
are blocked from the target. The second executes recovery and rollback from a
validated fresh clone, starting from newly hydrated bridge data, performing
cutover, verifying externally and applying the signed rollback. Both fail if
elapsed time reaches four hours and both emit signed evidence. Provider-created
rehearsal servers are firewalled before boot and destroyed only after their
reports are retained.

The system is not considered ready until two live reports pass, the current
production image set is fully pinned, provider and account scope checks and
alerts are observed, and an operator completes the printed card without
undocumented intervention. Code and unit tests alone cannot satisfy those
gates, which is why the test suite is described as offline evidence rather than
as recovery proof.

## Related monitoring

The website resource checker runs on its own timer on the Pi and shares the web
application's implementation and its named encrypted deep-health credential.
[Resource monitoring](../../docs/dr/README.md#resource-monitoring) covers how it
relates to the external monitoring provider and to the status history the public
site reads.
