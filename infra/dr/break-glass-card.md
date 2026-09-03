# Deniz disaster recovery — break-glass card

1. On the Mac, unlock both independent restic password files, open Terminal, and check status: `infra/dr/status --config /path/to/dr.env`. Stop if either iCloud-confirmed snapshot is missing or older than 24 hours.
2. Run the non-mutating preflight: `infra/dr/recover --config /path/to/dr.env --profile all --snapshot latest --check-only`.
3. Provision or select a clean Ubuntu 24.04 x86_64 VPS with at least 8 vCPU, 16 GB RAM, 300 GB disk, and root SSH. Do not install or edit anything on it. Verify the SSH host-key fingerprint through the provider console before typing it into recovery.
4. Confirm this Mac is connected to the reviewed tailnet. Recover without public traffic first: `infra/dr/recover --config /path/to/dr.env --host root@IP --profile all --snapshot latest --no-cutover`. Bootstrap closes public SSH and records the recovery server's Tailscale transport in the signed report; do not disconnect the Mac from Tailscale.
5. Read the generated signed report. Confirm PostgreSQL data/roles/owners/ACLs, MongoDB documents/indexes/users/roles, Redis key/value fingerprints, both namespace branches, search rebuild, TUS/download/range probes, terminal, relay, and every recorded Forge digest passed.
6. For an outage, rerun the same command without `--no-cutover`. The signed no-cutover checkpoint is promoted without restoring twice. The tool creates a signed reverse patch and then asks you to type `CUTOVER` before it fences writers or changes public traffic.
7. If checks fail before writes reach DR, run `infra/dr/rollback --config /path/to/dr.env --patch /path/from/report/reverse-dns-patch.json --report /path/from/report/report.json` and type `ROLLBACK`. It fences DR, restarts and verifies the original writers, restores DNS, verifies public health, and re-signs the report. If DR accepted writes, do not roll back to stale home data; recover the new DR snapshot home instead.
8. Keep the VPS and elevated monitoring for 24 hours. Preserve the report, signatures, and reverse patch. Destroy a rehearsal VPS only after retaining those files.

STOP on: unverified/stale iCloud completion; signature/checksum failure; undersized or populated target; unavailable exact package/database major; missing credential; source writer not fenced; semantic, digest, local health, external health, or Cloudflare-base mismatch.
