The API, Cloud, Storage and applications hosted on my infrastructure suffered an extended outage after the primary server became unreachable. Services are now running on replacement infrastructure. The data recovery is not complete.

The replacement is using a database and storage backup captured on **9 November 2026**. Records and files created or changed after that backup may be missing from the live services. This includes affected Shortn links, edits and analytics. That data is temporarily unavailable while the original server remains inaccessible; I have not established that it has been permanently destroyed.

I plan to regain physical access to the original server around **20 December 2026** and recover the missing data from its storage. That is the recovery target, not a guarantee: the outcome depends on the original storage being intact. I am sorry for the outage, the missing data and the uncertainty this has caused.

## What happened

The primary host stopped providing the network access needed to run and maintain the services. It still answered a local ping, but SSH access failed, Tailscale was unavailable and the public tunnel could not reach its origin. A power cycle did not restore access.

Those observations establish a host-access failure. They do not establish whether the underlying cause is the operating system, storage, networking or another hardware problem. I cannot responsibly name a root cause until I can inspect the machine.

Because I could not repair it remotely, I moved the affected services to a replacement server at Hetzner. The original server is disconnected from power and Ethernet. Keeping it isolated protects its storage and prevents it from rejoining production with an older, conflicting view of the system.

## Why the data recovery point is 9 November

The recovery point was older than it should have been. I restored the latest usable pre-failure database and storage backup available offsite, then checked whether a newer backup existed without a completion confirmation.

That check included the raw encrypted snapshot inventories, not just the list of confirmed backups. At the time of the audit, iCloud contained 53 Pi snapshots. The offsite repository contained 54, including a new backup made after the replacement had been restored. Neither inventory contained a newer pre-failure database snapshot than the 9 November capture.

The newer backup from the replacement does not recover the missing days. It protects the restored state and subsequent activity.

There was a more recent backup of the deployment host, from 15 November. That backup preserved application images, routing information and encrypted runtime configuration. It helped recover the applications, but application images are not a substitute for their databases and user files.

The distinction matters: having the newest application code running does not mean the newest user data has been restored. The effective offsite recovery point was not good enough, and that is my responsibility.

## A second problem during recovery

The restored control plane had a 9 November view of deployments. The surviving deployment host had applications created after that date.

When scheduled garbage collection ran, it treated 21 newer containers as obsolete because they were absent from the older control plane's keep list. This prolonged the outage for frontends whose API and databases were already reachable.

I stopped destructive maintenance, preserved the database before reconciliation, and reconstructed the newer deployment inventory from the signed 15 November backup, backed-up routes and actual GitHub deployment records. All 37 production applications were then restored from pinned images with verified environments. Missing saved configuration and two storage credentials were reconciled as well.

The cleanup logic now preserves running deployments that are absent from a control plane's keep list. It also refuses forced container removal, so a container that starts again during a sweep is protected. The recovery procedure pauses destructive maintenance before starting an older control plane. A live cleanup preview after reconciliation proposed no container removals and reported no failures.

## What is working now

Public checks pass for the API, Cloud, sign-in, Storage, Forge and the main website. Database TLS connections and end-to-end database, file, object-storage and search transactions have also passed. External uptime monitors confirm availability.

The restored namespace was checked for file contents and metadata, including ownership, permissions, extended attributes and portable ACLs. Database checks verified the restored baseline. These checks establish that the selected backup was restored consistently; they do not establish that post-backup data has been recovered.

Fresh backups have completed on the replacement and deployment hosts and have been copied offsite. I also fixed a temporary-space problem that could prevent later backups from fitting the recovery server, and corrected backup reporters that the edge firewall was blocking. The status page is receiving live observations again.

A separate missed version bump had prevented an intended release from triggering. That release issue was corrected as part of the work, but it does not explain why the primary host became unreachable.

## Timeline

- **9 November, 05:27 UTC:** capture began for the latest usable pre-failure database and storage backup found in the offsite inventories.
- **15 November:** recovery onto replacement infrastructure began after remote repair attempts failed. The original host was physically isolated.
- **16 November:** the full production application inventory was restored and reconciled, public checks passed, and the backup inventories were audited for newer unconfirmed recovery points.
- **Around 20 December:** planned physical inspection of the original server and recovery of the missing data, subject to its storage being readable.

The exact onset and underlying cause of the primary-host failure remain under investigation. I will update this account when physical inspection provides evidence.

## How the remaining data recovery will work

The live replacement will continue accepting new activity. When I can read the original storage, I will take a protected copy, inspect it away from production, and compare the recoverable records and files with the live state.

I will not simply restore the old server over the replacement. That would risk losing new activity created since services returned. Recovery will require reconciliation, including handling records changed on both systems and checking links between database records and stored files.

The goal is to restore the temporarily missing data around 20 December while preserving new work. If the storage is damaged or the recovery date changes, the status incident will be updated rather than presenting the target as a certainty.

## What changes after this incident

Several fixes are already in place: conservative container cleanup, recovery-time maintenance fencing, stricter restore checks, corrected disk monitoring, working backup reporters and offsite backups from the replacement.

The remaining work is to make backup freshness and confirmation failures visible early enough to act on them, verify that a usable recovery point meets the intended recovery window, and exercise recovery against a surviving host whose state is newer than the restored database. A successful backup job, an uploaded repository and a successful application build are different pieces of evidence; none should be mistaken for all of them.

I am keeping the incident open while the data recovery is pending. Current updates are available on the [status incident](https://status.denizlg24.com/incidents#manual:7c90c4eb-3bce-44c5-8b27-36437623f432).
