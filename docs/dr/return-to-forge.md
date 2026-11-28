# Return Pi Cloud and Hetzner production to Forge

Use this in order with the machine in front of you. The end state is one physical Forge server. Its existing Ubuntu installation continues running the deployment agent, Caddy and the deployed apps. A separate Ubuntu guest **on Forge** runs the former Pi/Hetzner cloud stack. This gives the restore tool the clean target it requires and keeps its Docker, firewall, mount and systemd changes away from the serving host.

Commands marked **Mac**, **Forge**, **rescue Linux** and **guest** belong on different machines. Linux snippets use Bash. Use the operator's private worksheet for SSH aliases, exact snapshot IDs, disk serials, keys and route values. Keep worksheet outputs on encrypted storage outside Git. The November backup repair is complete. Recovery of the missing Pi history still requires the physical disks.

## 1. Before opening a case — Mac

1. Arrange a maintenance window for Forge's RAM installation. Hetzner can keep serving cloud data, but sites running on Forge will be down while it is off and during the memory test. Reserve a separate window for the final data freeze. Determine that window from the rehearsal.
2. Put the new RAM, 8 TB disk, monitor/TV, USB keyboard and micro-HDMI cable on the bench. Bring the Pi power supply, a **fresh** rescue microSD, a spare card reader, a screwdriver, a SATA data cable and power connector or powered 3.5-inch USB dock. Check for an NVMe reader supporting the Pi module's length. Pre-install GNU ddrescue (Ubuntu package `gddrescue`), cryptsetup, smartmontools, nvme-cli, rsync, ACL and xattr tools on rescue Linux while it has internet. Verify a local console login with Ethernet disconnected. Keep the disk encryption passphrase and DR recovery credentials accessible offline.
3. From a clean checkout with the operator's private DR configuration installed, check the latest signed points and size the target. Save each return code and report. The separate Pi and Forge timestamps matter because the combined selector can select an older compatible pair.

```bash
umask 077
case_dir=$(mktemp -d "$HOME/forge-return.XXXXXXXX")
for profile in pi forge all; do
  infra/dr/recover --profile "$profile" --source r2 --snapshot latest --simulate \
    > "$case_dir/$profile-plan.json" || break
  jq '{snapshots: [.snapshots[] | {snapshotId,captureStartedAt}],
       requiredTargetDiskBytes,preflightCompatible,blockers,rpo24HoursMet}' \
    "$case_dir/$profile-plan.json"
done
```

4. Identify the common database/file backup from **9 November 2026, 05:27 UTC**, the 15 November Forge deployment evidence, and fresh captures from both serving hosts. Keep an independent encrypted copy of the baseline and evidence through sign-off. Verify the baseline by its exact signed Pi ID using the same simulation with `--snapshot "$BASE_ID"`. Record the R2 destination restic ID as well. If a fresh point fails verification, resolve that before taking a server offline.
5. Inventory live workloads and additional state that the standard DR profiles omit. For each, record owner, source path/database, secret source, target, writer/freeze method, health probe and a test using real data. Include personal/game directories, app bind mounts, Markets Relay's archive, PiCron database/jobs, optional nutrition service, external database clients, and any data on the USB disk. Record externally hosted integrations as dependencies. Capture current Cloudflare routes and DNS, TTLs, tailnet identities, DB TLS names, DDNS/router rules, CI destinations and active-site TXT values. Preserve the encrypted environments and pinned image digests.

```bash
# Mac. Replace the aliases using the private worksheet.
for host in forge dr-cloud; do
  ssh "$host" 'hostname; lsblk -o NAME,MODEL,SERIAL,SIZE,TRAN,FSTYPE,MOUNTPOINTS;
    df -hT; findmnt -o TARGET,SOURCE,FSTYPE; sudo -n docker ps -a --format "{{.Names}} {{.Image}} {{.Status}}";
    sudo -n docker volume ls; systemctl list-timers --all --no-pager; ss -lnt' \
    > "$case_dir/$host-inventory.txt" || break
done
```

**Proceed when** you can read the offline credentials, identify the recovery points and account for every writable service. [DR command reference](../../infra/dr/README.md) · [Protected state inventory](../../infra/dr/inventory.yaml) · [Incident timeline](../postmortems/2026-11-16-cloud-outage.md)

## 2. Install and test the RAM and the 8 TB disk — Forge

1. Record `sudo dmidecode -t 17`, `lsblk -d -o NAME,SIZE,MODEL,SERIAL,TRAN` and the result of `sudo systemctl --failed`. Confirm Forge's latest offsite backup, pause new deployments, and let running builds finish. From its console run `sudo systemctl poweroff`. Wait for shutdown, switch the PSU off, unplug mains and discharge static on the chassis.
2. Photograph the current connections and DIMM locations. On the MSI Z370 GAMING PLUS leave the two working 16 GB DIMMs seated. Fit the additional two 16 GB DDR4 desktop UDIMMs in the empty slots, aligning the keyed notch and closing the latches. For an internal SATA 8 TB disk, secure it in a bay, connect SATA data to a spare board port and power from the existing PSU's own harness. For a USB disk, keep its enclosure and use the supplied power. Leave both existing Forge drives connected as before. Keep every original Pi drive unplugged.
3. Boot to firmware. Expect **64 GB**, the old Toshiba SATA SSD as the boot device, and the new disk with its recorded model/serial. Use standard memory timings with XMP off. Run a bootable memory test through several complete passes. On errors, shut down, reseat and retest. Return to the original pair if necessary so Forge can serve again.
4. Boot normal Ubuntu. Check `free -h`, `sudo dmidecode -t 17`, `lsblk -o NAME,MODEL,SERIAL,SIZE,FSTYPE,MOUNTPOINTS`, `findmnt -T /mnt/storage/forge`, `systemctl is-active forge-agent forge-caddy forge-buildkit` and a previously working public app. Compare with step 1. Check SMART on each identified drive (`sudo smartctl -x /dev/disk/by-id/...`). Test the new disk before entrusting images to it. Run the long self-test on the **new blank disk**, then read its self-test log after the manufacturer's estimated time. Investigate media errors before imaging. [MSI manual and support](https://www.msi.com/Motherboard/Z370-GAMING-PLUS/support)

## 3. Prepare recovery storage — rescue Linux or Forge console

Use the new disk first as a vault for Pi images. Budget raw bytes for the 4 TB USB disk + 1 TB PlayStation disk + full Pi NVMe + any boot card, then allow for filesystem overhead, exports, writable copies and free space. An 8 TB marketed disk is about 7.28 TiB. An independently stored second copy or separate working disk may be necessary. Never count free space twice through bind mounts. If the target cannot hold the measured inputs, borrow or add space before continuing.

**One-time provisioning for a factory-empty disk.** These commands erase the selected device. Unplug all Pi originals. Identify the new disk by its physical label, previous inventory and persistent **whole-disk** by-id name. Inspect partitions, signatures, device holders, swap, mounts and LVM first. Stop if any data or unexpected signature exists. On a disk already prepared for this recovery, unlock and mount the existing filesystem instead.

```bash
lsblk -p -o NAME,TYPE,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINTS
ls -l /dev/disk/by-id/
read -r -p 'Whole by-id path of the NEW EMPTY 8 TB disk: ' vault
test -b "$vault" && test "$(lsblk -dn -o TYPE "$vault")" = disk
sudo wipefs --no-act "$vault"
lsblk -o NAME,SIZE,SERIAL,FSTYPE,MOUNTPOINTS "$vault"
swapon --show
sudo pvs
```

After matching its serial in person, run the following as a separate step. Store the LUKS passphrase offline immediately. An unreadable vault defeats recovery.

```bash
prepare_blank_vault() (
  set -eu
  [[ "$vault" == /dev/disk/by-id/* && -b "$vault" ]]
  test "$(lsblk -dn -o TYPE "$vault")" = disk
  test "$(lsblk -nrpo NAME "$vault" | wc -l)" -eq 1
  test -z "$(lsblk -dnro MOUNTPOINTS "$vault" | tr -d '[:space:]')"
  test -z "$(sudo wipefs --noheadings --output TYPE "$vault")"
  test ! -e /dev/mapper/forge_return_8t
  if mountpoint -q /mnt/recovery; then exit 1; fi
  serial=$(lsblk -dnro SERIAL "$vault" | xargs)
  test -n "$serial"
  read -r -p 'Type serial from the physical label of the blank disk: ' confirmed
  test "$serial" = "$confirmed"
  sudo cryptsetup luksFormat --type luks2 "$vault"
  sudo cryptsetup open "$vault" forge_return_8t
  sudo mkfs.ext4 -m 0 -L FORGE_RECOVERY /dev/mapper/forge_return_8t
  sudo install -d -m 0700 /mnt/recovery
  sudo mount /dev/mapper/forge_return_8t /mnt/recovery
  sudo install -d -m 0700 /mnt/recovery/{images,evidence,exports}
)
# Run as a standalone command so a failed check stops the provisioning subshell.
prepare_blank_vault
findmnt --mountpoint /mnt/recovery
df -B1 /mnt/recovery
```

## 4. Open the Pi on a monitor and image its media — offline

1. With power removed, photograph the Pi, HAT, NVMe, card, USB disk and each cable. Label each source. Disconnect Ethernet, the original boot card, the NVMe/HAT and the two HDDs. Insert a **fresh, known-good rescue microSD** without saved Wi-Fi. Connect micro-HDMI to the Pi port labelled HDMI0, HDMI to the monitor, select that input, attach a USB keyboard, then apply power. The display cable carries video to a monitor/TV. A typical laptop HDMI port is an output.
2. Log in locally. Run `hostnamectl`, `ip -br link`, `ip route`, `sudo rfkill block wifi` and `lsblk -o NAME,SIZE,MODEL,SERIAL,RO,MOUNTPOINTS`. Leave the Pi disconnected from LAN, Wi-Fi and tailnet. If the display stays dark, power off, check the input/cable and boot card, and retry with rescue media only. You can image removed media from another Linux machine even if the Pi never boots. Use a monitor/keyboard with a **writable clone** later to examine the original OS and its journal. [Raspberry Pi setup guide](https://www.raspberrypi.com/documentation/computers/getting-started.html)
3. On the imaging machine use a headless rescue environment with automount and automatic MD/LVM activation disabled, or a hardware write blocker. Connect the vault. After moving it to another Linux machine, run `sudo cryptsetup open "$VAULT_BY_ID" forge_return_8t`, `sudo mkdir -p /mnt/recovery`, `sudo mount /dev/mapper/forge_return_8t /mnt/recovery` and `findmnt --mountpoint /mnt/recovery`. Use its physical serial to set `VAULT_BY_ID`. Connect **one** original via the correct reader, dock or HAT. Power down before moving a HAT or bare internal device. Keep the 4 TB USB disk in its original enclosure. Identify the source by serial/capacity and confirm neither it nor its children are mounted, in swap or active as a volume.
4. In a root Bash shell (`sudo -i`), run the following once per device. Set a different label each time, e.g. `pi-boot`, `pi-nvme`, `pi-ps-hdd`, `pi-usb4`. For an SD card with no by-id alias, identify the whole device by reinsertion, capacity and card CID and record those values. The output is always a regular file beneath the verified vault.

```bash
image_one() (
  set -eu
  mountpoint -q /mnt/recovery
  test "$(findmnt -n -o UUID --mountpoint /mnt/recovery)" = \
       "$(blkid -s UUID -o value /dev/mapper/forge_return_8t)"
  read -r -p 'Whole source device path: ' src
  read -r -p 'Unique source label: ' label
  [[ "$label" =~ ^pi-[a-z0-9-]+$ ]]
  test -b "$src" && test "$(lsblk -dn -o TYPE "$src")" = disk
  lsblk -p -o NAME,TYPE,MODEL,SERIAL,SIZE,RO,MOUNTPOINTS "$src"
  ! lsblk -nrpo MOUNTPOINTS "$src" | grep -q '[^[:space:]]' || exit 1
  blockdev --setro "$src"
  test "$(blockdev --getro "$src")" = 1
  img="/mnt/recovery/images/$label.img"
  map="/mnt/recovery/evidence/$label.map"
  test ! -e "$img" && test ! -e "$map" || exit 1
  bytes=$(blockdev --getsize64 "$src")
  test "$(df -B1 --output=avail /mnt/recovery | tail -1)" -gt "$bytes"
  test ! -e "/mnt/recovery/evidence/$label.device"
  lsblk -bdno MODEL,SERIAL,SIZE "$src" > "/mnt/recovery/evidence/$label.device"
  ddrescue -n "$src" "$img" "$map"
  ddrescuelog -t "$map"
  sync
)
image_one
```

5. For an interrupted image, confirm the exact same serial, capacity, vault, image and map; repeat `ddrescue -n "$src" "$img" "$map"` using those recorded paths. For remaining bad regions on a stable drive, a limited retry is `ddrescue -r1 "$src" "$img" "$map"`. Stop a mechanically unstable disk and consider specialist recovery. A hash validates the copy you have, including any unreadable regions recorded by the map. Run `ddrescuelog -D "$map"` on each map to test full rescue, compare image length with source bytes, and record exceptions. After the last pass, from `/mnt/recovery/images` run `sha256sum -- *.img > ../evidence/images.sha256` and `sha256sum -c ../evidence/images.sha256`. Verify a second independent copy before releasing any original for reuse. [GNU ddrescue manual](https://www.gnu.org/software/ddrescue/manual/ddrescue_manual.html)

6. To release the Pi NVMe for Forge, make the second copy concrete. On Linux mount another **independent, encrypted physical disk** with enough space and verify its device and UUID. Substitute its mount point below. Keep the other originals through sign-off. A second folder or partition on the 8 TB disk shares its failure risk.

```bash
# Root on rescue Linux. Use the same label you recorded in step 4.
(
  set -eu
  mountpoint -q /mnt/recovery
  mountpoint -q "${SECOND_MOUNT:?set to independent encrypted disk mount}"
  lsblk -o NAME,PKNAME,SERIAL,SIZE,UUID,MOUNTPOINTS
  cd /mnt/recovery/images
  label=pi-nvme
  mkdir -p "$SECOND_MOUNT/images" "$SECOND_MOUNT/evidence"
  rsync -aS --partial "$label.img" "$SECOND_MOUNT/images/"
  cp ../evidence/"$label".{device,map} "$SECOND_MOUNT/evidence/"
  awk -v file="$label.img" '$2 == file' ../evidence/images.sha256 > "$SECOND_MOUNT/evidence/$label.sha256"
  cd "$SECOND_MOUNT/images"
  sha256sum -c "../evidence/$label.sha256"
)
```

## 5. Recover the Pi's data from copies

1. Disconnect the originals and store them with the labels. On **isolated rescue Linux**, attach an image read-only. For a plain ext4 partition use the discovered partition name in the mount command. LUKS, LVM, MD and other filesystems need their own read-only activation or an isolated VM. In particular, keep duplicate LVM identities away from the running Forge host.

```bash
loopdev=$(sudo losetup --find --show --partscan --read-only /mnt/recovery/images/pi-nvme.img)
lsblk -f "$loopdev"
sudo mkdir -p /mnt/pi-inspect
# Only for an identified ext4 partition.
sudo mount -t ext4 -o ro,noload "${EXT4_PARTITION:?set to the identified loop partition}" /mnt/pi-inspect
# After recording fstab, DB paths, service definitions and the mount layout:
sudo umount /mnt/pi-inspect && sudo losetup -d "$loopdev"
```

2. Inspect the Pi boot/root image, its `/etc/fstab`, Compose configuration and actual data paths. Map UUIDs to each of the imaged devices. Include data outside configured namespaces, hidden files, Samba identities, project objects, PiCron state, additional applications and game saves. For historical diagnosis use `journalctl --directory=/mnt/pi-inspect/var/log/journal --list-boots` if persistent journals exist.
3. Recover raw database directories by starting **writable copies** with the original major versions, ownership, data paths and matching architecture. Use the Pi with cloned boot media and cloned writable data disks on the offline bench, or an isolated ARM-compatible VM. Keep scheduled jobs, API, tunnel, deploy agent and other external side effects off. Start only the DB services needed to export. Where an ext4 journal needs replay let that occur on the working copy. Never let two servers share a DB directory.
4. Export logically into a private directory on separate working storage. For PostgreSQL, inventory *all* non-template databases, preserve roles, then dump each. Below, `PG_CONTAINER` is the identified clone container. For MongoDB use the clone's existing protected database-tools config with `mongodump --config=/private/client.yml --archive --gzip --oplog` on a replica set, and save stdout to a file; only use `--oplog` with a full dump. For a standalone server keep it quiescent for the complete dump. Preserve the Redis RDB/AOF, ACLs, absolute expiries and a per-key-type inventory separately. Take a consistent SQLite backup of PiCron from its clone using SQLite's `.backup` command. Store credentials and dumps under mode 0600.

```bash
# Bash on the writable clone host, output mounted on the separate export disk.
set -euo pipefail
umask 077
cd "${EXPORT_DIR:?set to private, mounted working storage}"
docker exec "$PG_CONTAINER" sh -eu -c 'exec pg_dumpall -U "$POSTGRES_USER" --globals-only' > roles.sql
docker exec "$PG_CONTAINER" sh -eu -c 'exec psql -XAt -U "$POSTGRES_USER" -d postgres -c "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY 1"' > databases.txt
while IFS= read -r db; do
  [[ "$db" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
  docker exec "$PG_CONTAINER" sh -eu -c 'exec pg_dump -U "$POSTGRES_USER" -Fc --create -d "$1"' sh "$db" > "$db.dump"
  pg_restore --list "$db.dump" > "$db.toc"
done < databases.txt
sha256sum -- *.dump roles.sql > postgres.sha256
```

**Proceed when** an isolated logical restore opens the Pi databases and representative missing records/files, and every damaged or missing source is recorded. Preserve the raw images even after export.

## 6. Build the cloud guest on Forge and rehearse a restore

1. Keep Forge's SATA SSD as its boot/Docker disk and the existing 1 TB HDD mounted at `/mnt/storage`. Use the recovered NVMe for the guest only after it is fully imaged, independently copied, verified and explicitly released. Inspect its length, SMART health and capacity. The board has one Gen3 ×4 M.2 slot for 2242/2260/2280/22110. A 2230 needs a correct mechanical adapter. If the NVMe cannot be released or is too small, borrow or buy a separate SSD. Install the drive with power removed, the standoff at the correct length and the old boot order preserved. The 8 TB vault stays independent. [MSI storage specifications](https://www.msi.com/Motherboard/Z370-GAMING-PLUS/Specification)
2. On **Forge** run `lscpu | grep Virtualization`, `test -c /dev/kvm`, and enable Intel VT-x in firmware if required. On Ubuntu install `qemu-kvm libvirt-daemon-system virtinst`; run `sudo virt-host-validate qemu`. Prepare a persistent ext4 filesystem on the released/new SSD by stable ID (same identification procedure as step 3). Mount by UUID at e.g. `/srv/forge-cloud-vm`. If using encryption, arrange an unlock method that works after a remote reboot. Verify `findmnt --mountpoint /srv/forge-cloud-vm` after reboot before creating a guest. Keep the VM image off the small host root.
3. Using Virtual Machine Manager connected to Forge's libvirt over SSH, create **cloud-home**, Ubuntu Server 24.04 amd64, **8 vCPUs, 24 GiB RAM** as a starting allocation on the 64 GB host, virtio networking and a nonrotational SSD-backed virtio disk. Put the disk image on the mounted SSD. Size the guest root to exceed the Pi simulation's `requiredTargetDiskBytes`, with real backing capacity for growth, staging and at least 20% free after restore. Use a plain ext4 root that the preflight can identify; verify `findmnt -no SOURCE /`, `lsblk -o NAME,ROTA,SIZE`, `df -B1 /` inside the guest. Run disk, memory and filesystem checks on the **guest and host**. Sparse allocation can otherwise hide physical exhaustion. Later, a separate virtual disk on the 1 TB HDD can house the cold branch after a verified copy with writers stopped and a tested mount dependency.
4. Give the guest its own private management IPv4 reachable from the Mac, a distinct MAC/hostname, and key-only root SSH for bootstrap. Record the console's `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` fingerprint. Use a distinct recovery tailnet identity. Keep production routes pointed at their current hosts. Enforce isolation **outside** the guest before restore: allow operator management, local test dependencies, NTP, package/registry/R2 downloads and tailnet bootstrap, and deny contact with production writer endpoints, deploy-agent controls, mail/webhook destinations and provider-write APIs from the restored apps. Test a denied destination from the guest and a test container. The restore starts the API, relay and PiCron; `--no-cutover` alone cannot contain their side effects. Keep the restoration in the lab if its network rules cannot satisfy both download and isolation requirements. [Ubuntu libvirt guide](https://documentation.ubuntu.com/server/how-to/virtualisation/libvirt/)
5. On the **Mac**, use the exact signed Hetzner Pi snapshot from step 1. Recheck freshness. Supply a new guest with an empty `/srv` and `/opt`, installed `jq`, working time sync and the target prerequisites. Use a clean committed checkout and an installation-specific private recovery config. Run:

```bash
infra/dr/recover --profile pi --source r2 --snapshot "${HETZ_ID:?set signed Pi capture ID}" --check-only --no-cutover
infra/dr/recover --profile pi --source r2 --snapshot "$HETZ_ID" \
  --host "root@${GUEST_IPV4:?set the clean guest IPv4}" --no-cutover
```

   Compare the printed SSH fingerprint with the VM console and retain the signed recovery report. Check database verification, zero namespace mismatches, pinned images and deep transactions. Only the Pi profile belongs on this guest. Limit staging jobs before editing state. Read the exact private Compose override/mount settings created by restore. Keep DB files on local ext4. Confirm the merged namespace, both physical branches, SMB broker and separate `.s3-v2` tree have the expected owners and backing devices. [Restore preflight and requirements](../../infra/dr/README.md#recovery)

## 7. Merge the history before promoting the guest

Use three private inputs: **B** is the signed 9 November baseline, **P** is the recovered Pi, **H** is the post-failover Hetzner snapshot. **Candidate** starts as a copy of H. Keep the evidence copies immutable. Reserve separate disk for working databases and files. One VM can host separate isolated database instances sequentially if space is limited.

1. Materialize B from the *specific* R2 snapshot. One route is the Pi restore command in step 6 with a **different empty scratch VM**, `--snapshot "$BASE_ID" --accept-stale-snapshot --no-cutover` and the same network isolation. An old point can have different package requirements. For data-only comparison, use the exact signed snapshot and verified artifacts in an offline environment rather than weakening a failed package check. Load P from the logical exports into another isolated instance. Export comparison data from H before editing the candidate. Bring disposable copies to a common schema using the application migrations; retain tables and fields removed by later migrations in the evidence.
2. Inventory primary keys, natural unique keys, tenant boundaries, foreign keys, delete markers, document IDs and object references for **every** database and file tree. As an example, run `psql "$LAB_PG_DSN" -X -c '\dt *.*'`, `psql "$LAB_PG_DSN" -X -c '\d+ public.titles'`, and `mongosh "$LAB_MONGO_URI" --quiet --eval 'db.getCollectionNames()'` against the isolated copies. Use protected authentication files where possible. Shortn needs link/slug, owner, destination and click-event identities. Stream's generated search columns can be recomputed and checked.
3. Generate comparison inputs per table/collection. For a PostgreSQL table with a stable `id`, this example emits canonical JSON for hashing and comparison. Substitute the actual qualified table, composite key and fields for the dataset. Run on B, P and H separately using the same query and schema. Keep all exported rows private.

```bash
# Example for the Stream titles table on a lab copy. LABEL is B, P or H.
psql "${LAB_PG_DSN:?set the lab DSN}" -XqAt -v ON_ERROR_STOP=1 \
  -c "SELECT jsonb_build_object('key',id,'row',to_jsonb(t) - ARRAY['search_title','search_people','search_keywords']) FROM public.titles t ORDER BY id" \
  > "${LABEL:?set B P or H}-titles.jsonl"
```

4. Compare the union of keys, treating absence as a separate value. Record the before/after hash, proposed operation, source and reason. For a single key use this decision table:

| Observation | Decision for candidate |
| --- | --- |
| P equals B | Keep H, including a later deletion on Hetzner. |
| P equals H | Keep one copy. |
| H equals B and P changed | Apply P's verified edit, addition or proven deletion. Inspect deletes against child records first. |
| B lacks the key and both branches created different values | Keep H serving. Preserve P and review the collision, including any references to the old ID or slug. |
| Both branches changed differently, including delete/edit | Preserve both, review the user-visible effect and record a decision. |
| B or a source region is unreadable | Mark unknown. Import independently verified additions only. |

   For the three complete Stream exports above, this read-only example produces a ledger of differences. It stops on duplicate or missing keys. Run it on private working storage. For very large tables, implement the same join in an indexed staging database. Feed unreadable inputs to manual review.

```bash
python3 - B-titles.jsonl P-titles.jsonl H-titles.jsonl > titles-review.jsonl <<'PYTHON'
import hashlib, json, sys

def load(path):
    rows = {}
    with open(path) as f:
        for line in f:
            record = json.loads(line)
            key = record["key"]
            if key is None or key in rows:
                raise ValueError(f"missing or duplicate key in {path}")
            data = json.dumps(record["row"], sort_keys=True, separators=(",", ":"))
            rows[key] = hashlib.sha256(data.encode()).hexdigest()
    return rows

base, pi, live = map(load, sys.argv[1:])
for key in sorted(base.keys() | pi.keys() | live.keys()):
    b, p, h = (rows.get(key) for rows in (base, pi, live))
    if p == b or p == h:
        continue
    decision = "review-conflict"
    if h == b:
        decision = "review-delete" if p is None else "candidate-pi-change"
    print(json.dumps(dict(key=key, base=b, pi=p, expected_live=h, decision=decision)))
PYTHON
```

5. Apply reviewed changes in the **candidate**. Use per-application transactions and parameterized SQL with the expected H value in the predicate, or MongoDB update filters containing the expected H fields/version. Require the affected count to match the ledger. Import parent objects before children, remap colliding IDs and references together, verify uniqueness and advance sequences where needed. Copy SQLite data through its schema and business keys. Deduplicate click/events by immutable event ID and rebuild derived totals. Retain Hetzner's current sessions, revoked credentials and security state. Review durable Redis values by key type and absolute expiry; reconcile pending jobs against completed external actions. Restore current deployment settings and routes from live Forge's inventory.
6. Compare **physical** SSD and HDD namespace branches and project S3 objects separately. Inventory path/object key, content hash, ownership, mode, ACL, xattrs, symlink target and allocation. Use a dry-run comparison in each direction for B↔P and B↔H. A sample for one pair is below. Each root must be a disposable copy. The tool reports differences; use the three-way rules before applying any.

```bash
sudo rsync -aHAXnci --numeric-ids -- "${BASE_BRANCH:?}/" "${PI_BRANCH:?}/"
sudo rsync -aHAXnci --numeric-ids -- "$PI_BRANCH/" "$BASE_BRANCH/"
# After review: approved paths must be safe relative paths, NUL-delimited,
# for one specific branch, including desired directory metadata.
sudo rsync -aHAXR --numeric-ids --from0 --files-from="$APPROVED_PATHS" \
  -- "$PI_BRANCH/" "${CANDIDATE_BRANCH:?}/"
```

   With `--files-from`, keep the list explicit (no added `--recursive`). For hard links, include each approved link in its group and verify inode/link counts afterward. Copy only the approved leaf paths and reviewed directory entries. Apply deletes explicitly from the ledger after verifying the target's expected hash. Preserve conflicts outside served directories. Verify every database-to-object reference, Samba principal, namespace identity and cross-tenant access. Keep incomplete uploads and caches out of the merge. Rebuild derived search indexes after canonical records are final.
7. Re-run the merge against the candidate: zero additional changes should result. Repeat against a newer H to exercise concurrent edits. Record imported, unchanged, deferred and unreadable counts per dataset. Time the final capture, transfer, verification, merge and smoke tests. Save the **actual reviewed** per-dataset SQL, Mongo operations, file lists and checksums outside Git as a replayable package. If these inputs are missing, keep Hetzner serving and continue reconciliation. A full restore by itself cannot supply the per-record decisions.

## 8. Rehearse routing, then freeze Hetzner and build the final candidate

1. Prepare a private route sheet with current value, new value, rollback value, TTL, credential owner and a probe for every API/tunnel hostname, direct DB DNS/TLS endpoint, SMB path, CI destination, macOS DR override and tailnet client. Identify a reachable Portugal WAN or private access route for each existing direct DB consumer. A home network behind CGNAT needs a tested alternative for those clients. Never publish a private guest IP as a public database address. Test the home connection from outside Portugal with production still on Hetzner.
2. Create a **distinct** Portugal tunnel/connector or use the reviewed home tunnel. Rehearse using test hostnames and private endpoints. Multiple active connectors for a single production tunnel can distribute requests to both origins. Keep public routes and backup leases on their current owners during rehearsal. Check Forge agent → cloud API and cloud API → agent. Save the current `CONTROL_PLANE_URL`, `DEPLOY_AGENT_URL`, secrets/config references, CI secrets, DNS export and signed inventory privately.
3. At the scheduled window enable maintenance on the API, apps, direct DB and file ingress. Stop or fence background writers, including relay, PiCron, uploads, SMB clients, direct database clients, Redis producers, webhooks and Forge deployment/cleanup jobs. Drain work and prove attempted writes fail from each former client. Record last committed IDs/timestamps and active sessions. The physical Pi remains offline. On **Hetzner**, leave DB engines running for the canonical backup. Preserve created Compose containers so the backup can still inspect image digests. For example, after reviewing live names, `sudo systemctl stop picron.service` and `sudo docker stop deniz-cloud-api-1 markets-relay-markets-relay-1` stop those writers; those two commands cover only part of the ledger. Block writes to the directly reachable databases and shares separately while retaining the backup account's local read access.
4. On **Hetzner**, capture the frozen state. Also take the verified final copies of any supplemental workloads from step 1. Keep all client writes fenced until a single site is promoted.

```bash
sudo systemctl start deniz-dr-backup@pi.service &&
sudo systemctl start deniz-dr-r2-sync@pi.service
systemctl show deniz-dr-backup@pi.service deniz-dr-r2-sync@pi.service \
  -p Id -p Result -p ExecMainExitTimestamp
```

   If a capture needs a service for inventory, preserve its container and keep every client and background writer fenced while satisfying that dependency. Confirm the runs completed on this attempt; the status detail must show a new signed capture and a verified R2 copy. A lock skip or a stale receipt cannot establish this boundary. On the Mac rerun the Pi simulation, pin the new ID as `FINAL_ID` and check its capture time follows the freeze. From the Mac restore **that exact ID to a fresh empty guest on Forge** as in step 6, then replay the reviewed merge and supplemental files. Use a second fresh guest, or recreate the rehearsal guest only after preserving its verified rollback image, ledger and reviewed scripts on independent storage. If space/time makes this approach infeasible, stay on Hetzner until an incremental final transfer has been rehearsed with equivalent evidence.
5. Stop the candidate's internal writers during replay. Start required dependencies and use private probes afterward. Verify merged counts, no broken references, Shortn redirects and click totals, Stream search, login, true file upload/readback, S3 put/get, SMB permissions as two users, market ingestion, cron state, optional services and all existing Forge hostnames. Use a synthetic tenant. Preview garbage collection and check it preserves every active deployment. Save the actual evidence and the list of unresolved exceptions. Reopen Hetzner if these checks cannot pass inside the window **before any public write has reached Forge**.

## 9. Put the cloud guest into production

1. With both sites still fenced against user writes, disable the old site's Pi-profile timers and external export ownership after the final capture. Wait for any in-flight jobs to finish. Keep its data and old endpoints available for rollback. On Hetzner:

```bash
sudo systemctl disable --now deniz-dr-backup@pi.timer deniz-dr-heartbeat@pi.timer \
  deniz-dr-r2-sync@pi.timer deniz-dr-r2-retention@pi.timer deniz-dr-external-export.timer
systemctl list-jobs --no-pager
```

2. On the guest set `DR_ACTIVE_SITE_VALUE=home` in the private `/etc/deniz-dr/pi.env`; verify the expected record name and independent signing/R2 settings. In the DNS provider change the **Pi-profile** active-site TXT value from its recorded DR value to `home` and verify it on authoritative DNS and a recursive resolver. Leave the physical Forge profile assigned to its existing owner. Replace the Mac's Pi SSH/bridge override with the guest's pinned identity. Keep a private reversible copy of the previous config. The repo's `cutover` expects the opposite lease direction, and its `rollback` assumes the DR site accepted no new writes. Perform the reviewed homeward route/lease changes from the worksheet.
3. Point the cloud API's private agent endpoint at the existing Forge agent. Under the deployment maintenance window update the physical agent's private `CONTROL_PLANE_URL` to the guest's verified API, then `sudo systemctl restart forge-agent` and verify health. Update CI and operator SSH aliases to the correct guest key/identity. Ensure direct DB clients have working TLS names, current certificates and firewalls. Switch the reviewed public API/storage routes to the home tunnel and the direct DB routes to their tested home endpoints. Keep existing Forge application routes in place unless the worksheet shows an actual change.
4. From an external connection check `dig +short "$API_HOST"`, `curl -fsS "https://$API_HOST/healthz"` and each application probe. Use the operator's private synthetic credential for the deep transaction. Verify the request arrived in the guest logs. On the guest, `findmnt -T /mnt/ssd`, `findmnt -T /mnt/hdd`, `docker ps`, `systemctl --failed` and `ss -lnt` should match the target inventory. Confirm imports and site-specific overlays survive a service restart. Open production writes on the guest only. Run a write/read/delete test under a synthetic tenant and store its transaction marker. Confirm the old origin cannot accept the same write. Re-enable exactly one copy of each scheduler, relay consumer, webhook and deployment task. Re-enable previously paused maintenance only after its keep-list matches the running inventory.
5. Activate backup ownership on the guest and verify from R2. Confirm external monitoring and Mac sync point to the guest. Configure the guest for autostart on the physical host (`sudo virsh autostart cloud-home`, substituting the final domain name). Require its SSD filesystem at boot before guest start. Keep the Forge host's own profile running independently.

```bash
# Cloud guest, after authoritative and recursive TXT agree with the home lease.
sudo systemctl enable --now deniz-dr-backup@pi.timer deniz-dr-heartbeat@pi.timer \
  deniz-dr-r2-sync@pi.timer deniz-dr-r2-retention@pi.timer deniz-dr-external-export.timer
sudo systemctl start deniz-dr-backup@pi.service
sudo systemctl start deniz-dr-r2-sync@pi.service
systemctl list-timers --all 'deniz-dr-*' --no-pager
```

   If sync reports it copied successfully but withheld its heartbeat because retention is overdue, review the retention preview and confirm the November baseline is protected, allow the scheduled retention job to pass, then rerun sync. Check the signed capture timestamp. Restore a Pi-only record and a post-failover Hetzner record/file **from the new offsite point** on a disposable target. Perform a controlled Forge reboot with someone at the console, check storage before enabling writers, then repeat the outside probes. Protect power to Forge, router and ONT; test an independent management or local console path.

## 10. Roll back if needed, then retire the old machines

- **Before a public write on Forge:** fence the guest, stop its writers/timers, restore old ingress, lease, agent, CI and bridge settings from the worksheet, verify Hetzner health, then resume Hetzner writers/timers. On the old site enable the same Pi-profile timers disabled in step 9, start only the previously running units/containers from the worksheet, and verify the previously configured DR lease and endpoint override. Check the next signed offsite capture.
- **After the first public write on Forge:** freeze writers again. Keep Forge authoritative while capturing a fresh verified DB/file snapshot including those writes. Restore or apply that delta onto a fenced Hetzner instance. Verify the transaction marker, uploaded bytes, schedules and references before transferring ingress and backup ownership back. If this cannot be verified, keep the service read-only while resolving forward.
- **Retire Pi Cloud:** once the applications pass on Forge, power the Pi down and label all originals with their matching image/map/checksum. Remove any stale Pi DNS, tunnel connector, tailnet machine and deploy/CI targets by pinned device ID. Compare IDs first: the Hetzner replacement may have used the same hostname. Revoke old *device-specific* keys, rotate shared secrets only after updating their active consumers, and test recovery with the remaining keys. Keep the Pi offline and its originals intact through sign-off. Repurpose the 4 TB USB disk for rotated encrypted backup and the PlayStation disk for scratch only after their unique data exists on two verified independent copies. A newly provisioned Pi for another role gets new boot media, identity and credentials.
- **Retire Hetzner:** keep it fenced for a proposed 14-day observation period with an encrypted final snapshot. Verify at least two successful Forge-site offsite backup cycles, an isolated restore, a cold boot, one scheduled job, a deployment plus rollback, and external checks. Export billing/resource inventory before releasing VM, volumes, IP or snapshots. Delete cloud resources only after explicit retirement approval.
- **Sign-off:** every service in the initial inventory has a working Forge endpoint or an explicitly recorded external dependency; original Pi and post-failover data are independently recoverable; every conflict or unreadable file has an owner and recorded disposition; only the home site accepts production writes. Keep the evidence workbook, rollback values and backup decryption instructions offsite.
