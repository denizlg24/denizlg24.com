# Mac backup copies

Install the R2 → iCloud menu bar app and `dr-backups` command:

```sh
infra/dr/macos/install --config /absolute/private/config.env --source r2
dr-backups status
```

The installer explicitly enables a long-running menu bar process, including
when an earlier installation was disabled. It appears as an iCloud-drive icon,
starts in the logged-in Aqua session, and schedules a copy at login and hourly
while the Mac is awake. Configuration and signing keys stay outside the
repository. The process uses its installed files and Homebrew PATH, so the
checkout need not stay open.

The menu shows live Pi and Forge phases. It can start a combined copy, start Pi
and Forge independently, download a verified encrypted backup to a chosen
folder, refresh status, and open task logs. Pi and Forge use separate locks, so
their manual copies can run at the same time. Downloads are locked by profile
and destination: the same repository cannot have two writers, while copies to
different recovery disks remain independent.

The command exposes the same operations without the menu:

```sh
dr-backups run                       # combined iCloud copy now
dr-backups run --profile pi          # independent Pi copy
dr-backups run --profile forge       # independent Forge copy
dr-backups status
dr-backups menu                      # reopen the menu app after Quit
dr-backups logs                      # open the log directory
```

The R2 mode needs Python 3.11+, restic, the existing R2 credentials, per-host
restic passwords, allowed signers, the Mac completion key, and iCloud heartbeat
URLs in the private config. It does not use SSH. The default installer source
remains `ssh` for existing installations.

## Download on demand

```sh
# Authenticate the latest compatible Pi/Forge pair and estimate disk usage.
dr-backups download --plan

# Download encrypted repositories to a volume with enough space.
dr-backups download --destination '/Volumes/Backup Disk/Server Backups'

# Download only Forge, using ~/Downloads/Server Backups by default.
dr-backups download --profile forge

# A specific signed recovery point can be selected per profile.
dr-backups download --profile pi --snapshot pi-cloud-YYYYMMDDTHHMMSSZ --destination /absolute/path
```

Each profile directory contains `repository/`, the original signed `ready/`
documents, and `download.json` with the local restic snapshot ID. Downloads use
restic copy, verify the signed snapshot-manifest hash, and read-check the entire
local repository before reporting success. They remain encrypted. Repeating a
download reuses restic data already present; the conservative capacity check
still reserves the selected snapshot's full size plus 5 GiB.

To inspect or extract a downloaded backup, use its per-host password file:

```sh
restic -r '/absolute/path/forge/repository' --password-file /private/forge-restic-password snapshots
restic -r '/absolute/path/forge/repository' --password-file /private/forge-restic-password restore SNAPSHOT_ID --target /new/empty/restore-directory
```

Extraction contains the original database dumps and filesystem archives. It
does not restore production services or supply the separate registry images.

## iCloud layout and verification

The copy lives under `DR_ICLOUD_ROOT/R2/{pi-cloud,forge}`. These are byte-for-byte
copies of R2's encrypted restic repositories, including all retained snapshots;
R2's separate host-signed READY documents keep their original paths. The
namespace is included. Existing SSH-bridge copies remain at their old paths.

The bridge checks R2's repository, authenticates host signatures, validates
encrypted object hashes, and waits for File Provider to confirm each upload.
Only then does it evict that object's local bytes, retaining its iCloud copy.
Four downloads run at once, in batches of at most 64 objects. Snapshot objects are published
after the data, indexes and keys. A Mac-signed receipt under `R2/receipts/` is
uploaded last. Interrupted cycles retain their checkpoint and retry hourly;
neither source deletions nor pruning are propagated to iCloud.

The first seed can take hours and needs enough iCloud quota for the complete
retained R2 repositories. `dr-backups status` and the menu report upload
progress; per-task logs are in `~/Library/Logs/deniz-dr/`. A successful Forge
copy alone does not clear the combined iCloud heartbeat. Both profiles must
finish with recent source data.

The status-page reporting wrapper is installed separately, with
`STATUS_AGENT_MAC_TOKEN` loaded into the installer's environment:

```sh
python3 infra/status/install-macos.py --dr-config /absolute/private/config.env
```

It reports the menu process state every minute and can ask the running app to
copy now or change its automatic interval. Initial seeds may run for up to 48
hours; the status page still warns about runs exceeding its normal five-hour
threshold. Later DR menu upgrades also update an already-installed status
runtime without reading or replacing its private token.

Re-running the installer restarts an idle menu process. If a legacy copy or a
menu-started task is active, installation stops before changing files; run it
again after that task finishes.

For recovery from this independent copy, use Finder's Download Now on the
required `R2/<host>` directory (on a Mac with sufficient space), copy the hydrated
repository to a recovery disk, then run `restic check --read-data` and restore
using that host's password. Verify the retained host READY signature and its
snapshot-manifest hash. The older `recover --source icloud` flow expects the
SSH bridge's generation manifests; it does **not** consume this R2 layout.
Automated target recovery continues to use `recover --source r2`.

This bridge is copy-only and has no iCloud retention policy: older objects remain
recoverable even after R2 retention removes them, so iCloud usage grows over time.
