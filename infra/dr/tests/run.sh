#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

root="$(cd "$(dirname "$0")/../../.." && pwd)"
dr_root="$root/infra/dr"
# shellcheck source=../lib/common.sh
source "$dr_root/lib/common.sh"

for script in \
  "$dr_root"/backup \
  "$dr_root"/backfill-forge-images \
  "$dr_root"/cutover \
  "$dr_root"/external-export \
  "$dr_root"/heartbeat \
  "$dr_root"/install-forge-registry \
  "$dr_root"/install-host \
  "$dr_root"/recover \
  "$dr_root"/rehearse \
  "$dr_root"/report \
  "$dr_root"/rollback \
  "$dr_root"/sign-isolation-evidence \
  "$dr_root"/status \
  "$dr_root"/weekly-alert-test \
  "$dr_root"/macos/dr-sync \
  "$dr_root"/macos/install \
  "$dr_root"/macos/uninstall \
  "$dr_root"/providers/hetzner \
  "$dr_root"/remote/bootstrap \
  "$dr_root"/remote/resource-sampler \
  "$dr_root"/remote/restore-forge \
  "$dr_root"/remote/restore-pi \
  "$dr_root"/tests/database-roundtrip.sh \
  "$dr_root"/tests/namespace-roundtrip.sh \
  "$root"/infra/scripts/ddns-update.sh \
  "$root"/infra/scripts/posix-namespace-backup.sh \
  "$root"/infra/scripts/posix-namespace-restore-verify.sh; do
  bash -n "$script"
done

bun "$dr_root/tests/validate-schemas.ts"
node --check "$dr_root/lib/mongo-semantic.js"
grep -Fq "redis.call('PEXPIRETIME', key)" "$dr_root/lib/redis-semantic.lua" \
  || dr_die "Redis semantic verifier does not preserve absolute expirations"
rendered_report="$("$dr_root/report" "$dr_root/tests/fixtures/recovery-report.valid.json")"
grep -Fq '24-hour iCloud RPO met: true' <<< "$rendered_report" \
  || dr_die "human recovery report omits the measured RPO result"
grep -Fq 'Required target disk: 300000000000 bytes' <<< "$rendered_report" \
  || dr_die "human recovery report omits the signed capacity requirement"

temporary="$(mktemp -d "${TMPDIR:-/tmp}/dr-contracts.XXXXXX")"
resource_samples_test="/tmp/deniz-dr-resource-samples-$$.jsonl"
trap 'rm -rf -- "$temporary"; rm -f -- "$resource_samples_test"' EXIT
dr_assert_managed_directory_path "$temporary/managed" "$temporary/managed/nested/path"
dr_assert_restic_object_path config
dr_assert_restic_object_path "data/ab/$(printf 'c%.0s' {1..64})"
[[ "$(dr_required_disk_bytes 0 0)" == 300000000000 ]] \
  || dr_die "recovery disk calculation did not enforce the 300 GB floor"
[[ "$(dr_required_disk_bytes 200000000000 10000000000)" == 490000000000 ]] \
  || dr_die "recovery disk calculation did not use the expanded restore footprint"
hetzner_types="$temporary/hetzner-server-types.json"
jq -n '{server_types:[{name:"cpx52",architecture:"x86",cores:12,memory:24,disk:480,deprecation:null,
  locations:[{id:1,name:"nbg1",available:true,recommended:true,deprecation:null}],
  prices:[{location:"nbg1",price_hourly:{gross:"0.1610"}}]}]}' > "$hetzner_types"
hetzner_quote="$(jq -ce --arg serverType cpx52 --arg region nbg1 --argjson requiredDiskBytes 480000000000 \
  -f "$dr_root/providers/hetzner-server-type.jq" "$hetzner_types")"
jq -e '.cores==12 and .memoryBytes==24000000000 and .diskBytes==480000000000 and
  .locationAvailable==true and .locationRecommended==true and .hourlyGrossEur=="0.1610"' \
  <<< "$hetzner_quote" >/dev/null || dr_die "Hetzner live-capacity quote parsing is inconsistent"
if jq -e --arg serverType cpx52 --arg region nbg1 --argjson requiredDiskBytes 480000000001 \
  -f "$dr_root/providers/hetzner-server-type.jq" "$hetzner_types" >/dev/null 2>&1; then
  dr_die "Hetzner provider guard accepted a server below the signed disk requirement"
fi
jq '.server_types[0].locations[0].available=false' "$hetzner_types" > "$temporary/hetzner-unavailable.json"
if jq -e --arg serverType cpx52 --arg region nbg1 --argjson requiredDiskBytes 300000000000 \
  -f "$dr_root/providers/hetzner-server-type.jq" "$temporary/hetzner-unavailable.json" >/dev/null 2>&1; then
  dr_die "Hetzner provider guard accepted a location reporting no current capacity"
fi
jq -cn '{at:"2026-09-03T10:00:00Z",memoryTotalBytes:1000,memoryAvailableBytes:600,
  diskSizeBytes:2000,diskUsedBytes:500,diskAvailableBytes:1500,cpuTotalJiffies:100,cpuIdleJiffies:60,
  load1:1,physicalInterfaceCount:1,physicalNetworkReceiveBytes:1000,physicalNetworkTransmitBytes:2000}' > "$resource_samples_test"
jq -cn '{at:"2026-09-03T10:00:05Z",memoryTotalBytes:1000,memoryAvailableBytes:400,
  diskSizeBytes:2000,diskUsedBytes:700,diskAvailableBytes:1300,cpuTotalJiffies:200,cpuIdleJiffies:100,
  load1:3,physicalInterfaceCount:1,physicalNetworkReceiveBytes:4000,physicalNetworkTransmitBytes:5000}' >> "$resource_samples_test"
jq -cn '{at:"2026-09-03T10:00:10Z",memoryTotalBytes:1000,memoryAvailableBytes:500,
  diskSizeBytes:2000,diskUsedBytes:650,diskAvailableBytes:1350,cpuTotalJiffies:300,cpuIdleJiffies:190,
  load1:2,physicalInterfaceCount:1,physicalNetworkReceiveBytes:6000,physicalNetworkTransmitBytes:9000}' >> "$resource_samples_test"
resource_summary="$("$dr_root/remote/resource-sampler" summarize --input "$resource_samples_test")"
jq -e '.samples==3 and .peakCpuPercent==60 and .peakLoad1==3 and .peakMemoryUsedBytes==600 and
  .minMemoryAvailableBytes==400 and .peakDiskUsedBytes==700 and .minDiskAvailableBytes==1300 and
  .physicalInterfaceCount==1 and .physicalNetworkReceiveBytes==5000 and .physicalNetworkTransmitBytes==7000' \
  <<< "$resource_summary" >/dev/null || dr_die "resource sampler summary lost a peak or transfer measurement"
if [[ -r /proc/meminfo && -r /proc/stat && -r /proc/net/dev ]]; then
  "$dr_root/remote/resource-sampler" once --output "$resource_samples_test"
  resource_summary="$("$dr_root/remote/resource-sampler" summarize --input "$resource_samples_test")"
  jq -e '.samples==1 and .peakCpuPercent==0 and .physicalInterfaceCount>=1 and
    .peakMemoryUsedBytes>=0 and .peakDiskUsedBytes>=0' <<< "$resource_summary" >/dev/null \
    || dr_die "resource sampler could not measure the Linux recovery host"
fi
if (dr_assert_restic_object_path 'data/ab/../../secret') >/dev/null 2>&1; then
  dr_die "restic object guard accepted path traversal"
fi
if (dr_assert_restic_object_path 'index/not-a-restic-object-id') >/dev/null 2>&1; then
  dr_die "restic object guard accepted a non-restic pathname"
fi
preflight_current="$temporary/preflight-current.json"
jq '.preflight | .oldestSnapshotAgeSeconds=7200 | .stale=false | .staleAccepted=false |
  .cutoverRequested=true | .intendedMutations += ["apply reviewed cutover"]' \
  "$dr_root/tests/fixtures/recovery-report.valid.json" > "$preflight_current"
dr_assert_recovery_preflight_compatible \
  "$dr_root/tests/fixtures/recovery-report.valid.json" "$preflight_current"
jq '.restoredBytes += 1' "$preflight_current" > "$temporary/preflight-incompatible.json"
if (dr_assert_recovery_preflight_compatible "$dr_root/tests/fixtures/recovery-report.valid.json" \
  "$temporary/preflight-incompatible.json") >/dev/null 2>&1; then
  dr_die "recovery checkpoint guard accepted a changed signed restore footprint"
fi
mkdir -p "$temporary/managed/nested"
ln -s "$temporary" "$temporary/managed/nested/link"
if (dr_assert_managed_directory_path "$temporary/managed" "$temporary/managed/nested/link/path") >/dev/null 2>&1; then
  dr_die "managed directory guard accepted a descendant symlink"
fi
touch "$temporary/managed/nested/file"
if (dr_assert_managed_directory_path "$temporary/managed" "$temporary/managed/nested/file/path") >/dev/null 2>&1; then
  dr_die "managed directory guard accepted a non-directory ancestor"
fi
ssh-keygen -q -t ed25519 -N '' -f "$temporary/signing-key"
chmod 0600 "$temporary/signing-key"
printf 'test-signer %s\n' "$(cat "$temporary/signing-key.pub")" > "$temporary/allowed-signers"
printf '{"schemaVersion":1,"value":"signed"}\n' > "$temporary/document.json"
dr_sign_file "$temporary/signing-key" deniz-dr-test "$temporary/document.json" "$temporary/document.json.sig"
dr_verify_file "$temporary/allowed-signers" test-signer deniz-dr-test "$temporary/document.json.sig" "$temporary/document.json"
printf '{"schemaVersion":1,"value":"tampered"}\n' > "$temporary/document.json"
if (dr_verify_file "$temporary/allowed-signers" test-signer deniz-dr-test "$temporary/document.json.sig" "$temporary/document.json") >/dev/null 2>&1; then
  dr_die "signature verification accepted tampered evidence"
fi

checkpoint_report="$temporary/recovery-report.json"
checkpoint_dir="$temporary/checkpoints"
mkdir -m 0700 "$checkpoint_dir"
jq '.phases=[] | .checks=[] | .result="in-progress"' \
  "$dr_root/tests/fixtures/recovery-report.valid.json" > "$checkpoint_report"
dr_begin_phase "$checkpoint_report" checkpoint-test
jq -e '([.phases[] | select(.name=="checkpoint-test" and .status=="running")] | length)==1' \
  "$checkpoint_report" >/dev/null
dr_finish_phase "$checkpoint_report" "$checkpoint_dir" checkpoint-test
dr_phase_done "$checkpoint_report" "$checkpoint_dir" checkpoint-test
printf '2000-01-01T00:00:00Z\n' > "$checkpoint_dir/checkpoint-test.done"
if (dr_phase_done "$checkpoint_report" "$checkpoint_dir" checkpoint-test) >/dev/null 2>&1; then
  dr_die "recovery checkpoint guard accepted a marker that disagrees with the report"
fi
rm -f -- "$checkpoint_dir/checkpoint-test.done"
if dr_phase_done "$checkpoint_report" "$checkpoint_dir" checkpoint-test; then
  dr_die "recovery checkpoint guard accepted an absent marker"
fi
dr_begin_phase "$checkpoint_report" checkpoint-test
jq -e '([.phases[] | select(.name=="checkpoint-test" and .status=="running")] | length)==1 and
  ([.checks[] | select(.name=="checkpoint-test checkpoint")] | length)==0' "$checkpoint_report" >/dev/null
printf '2026-01-01T00:00:00Z\n' > "$checkpoint_dir/orphan.done"
if (dr_phase_done "$checkpoint_report" "$checkpoint_dir" orphan) >/dev/null 2>&1; then
  dr_die "recovery checkpoint guard accepted a marker without a successful report phase"
fi

jq -S -c '.forgeControlPlane | sort_by(.deploymentId)' \
  "$dr_root/tests/fixtures/snapshot-manifest.valid.json" > "$temporary/pi-control-plane.json"
cp "$temporary/pi-control-plane.json" "$temporary/forge-control-plane.json"
dr_assert_forge_control_plane_pair "$temporary/pi-control-plane.json" "$temporary/forge-control-plane.json"
jq '.[0].hostname="different.denizlg24.com"' "$temporary/forge-control-plane.json" \
  > "$temporary/forge-control-plane-mismatch.json"
if (dr_assert_forge_control_plane_pair "$temporary/pi-control-plane.json" \
  "$temporary/forge-control-plane-mismatch.json") >/dev/null 2>&1; then
  dr_die "combined recovery pairing guard accepted different Pi and Forge inventories"
fi

# Status is deliberately local-only and must not collapse the last signed host
# observation into the last fully verified local-cache snapshot.
status_root="$temporary/status"
status_cache="$status_root/cache"
status_icloud="$status_root/Library/Mobile Documents/com~apple~CloudDocs/DR"
status_config="$status_root/config.env"
mkdir -p "$status_cache/state/host-observed/pi-cloud" "$status_cache/pi-cloud/2026-Q3/ready" \
  "$status_icloud/manifests/2026-Q3"
jq '.createdAt="2026-09-03T06:00:00Z" | .snapshotId="pi-cloud-20260903T060000Z"' \
  "$dr_root/tests/fixtures/ready-manifest.valid.json" > "$status_cache/state/host-observed/pi-cloud/pi-cloud-20260903T060000Z.json"
jq '.createdAt="2026-09-03T00:00:00Z" | .snapshotId="pi-cloud-20260903T000000Z"' \
  "$dr_root/tests/fixtures/ready-manifest.valid.json" > "$status_cache/pi-cloud/2026-Q3/ready/pi-cloud-20260903T000000Z.json"
dr_sign_file "$temporary/signing-key" deniz-dr-ready \
  "$status_cache/state/host-observed/pi-cloud/pi-cloud-20260903T060000Z.json" \
  "$status_cache/state/host-observed/pi-cloud/pi-cloud-20260903T060000Z.json.sig"
dr_sign_file "$temporary/signing-key" deniz-dr-ready \
  "$status_cache/pi-cloud/2026-Q3/ready/pi-cloud-20260903T000000Z.json" \
  "$status_cache/pi-cloud/2026-Q3/ready/pi-cloud-20260903T000000Z.json.sig"
jq '.createdAt="2026-09-03T01:00:00Z" | .uploadedVerifiedAt="2026-09-03T01:00:00Z" |
  .snapshotId="pi-cloud-20260903T000000Z" | .readySha256="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"' \
  "$dr_root/tests/fixtures/completion-manifest.valid.json" > "$status_icloud/manifests/2026-Q3/pi-cloud-20260903T000000Z.complete.json"
dr_sign_file "$temporary/signing-key" deniz-dr-complete \
  "$status_icloud/manifests/2026-Q3/pi-cloud-20260903T000000Z.complete.json" \
  "$status_icloud/manifests/2026-Q3/pi-cloud-20260903T000000Z.complete.json.sig"
{
  printf 'DR_PI_SSH=test@pi-cloud\nDR_FORGE_SSH=test@forge\n'
  printf 'DR_LOCAL_CACHE=%q\nDR_ICLOUD_ROOT=%q\n' "$status_cache" "$status_icloud"
  printf 'DR_ALLOWED_SIGNERS=%s\nDR_COMPLETION_SIGNING_KEY=%s\n' "$temporary/allowed-signers" "$temporary/signing-key"
  printf 'DR_COMPLETION_SIGNER=test-signer\nDR_HOST_SIGNER_PI=test-signer\nDR_HOST_SIGNER_FORGE=test-signer\n'
} > "$status_config"
chmod 0600 "$status_config"
status_output="$(DR_ICLOUD_HELPER=/usr/bin/true "$dr_root/macos/dr-sync" --config "$status_config" status)"
jq -e '.hosts[] | select(.host=="pi-cloud") |
  .hostSnapshot=="pi-cloud-20260903T060000Z" and
  .localVerifiedSnapshot=="pi-cloud-20260903T000000Z" and
  .iCloudConfirmedSnapshot=="pi-cloud-20260903T000000Z"' <<< "$status_output" >/dev/null \
  || dr_die "local DR status did not keep host, local, and iCloud recovery points separate"

# Combined recovery selects the newest compatible signed control-plane view,
# rather than blindly pairing each host's newest completion during a deploy.
pair_root="$temporary/pair-selection"
pair_icloud="$pair_root/Library/Mobile Documents/com~apple~CloudDocs/DR"
pair_cache="$pair_root/cache"
pair_config="$pair_root/config.env"
mkdir -p "$pair_icloud/manifests/2026-Q3" "$pair_cache"
pair_hash_old="$(printf '1%.0s' {1..64})"
pair_hash_pi_new="$(printf '2%.0s' {1..64})"
pair_hash_forge_new="$(printf '3%.0s' {1..64})"
for spec in \
  "pi-cloud pi 20260903T080000Z 2026-09-03T08:00:00Z $pair_hash_old" \
  "pi-cloud pi 20260903T100000Z 2026-09-03T10:00:00Z $pair_hash_pi_new" \
  "forge forge 20260903T083000Z 2026-09-03T08:30:00Z $pair_hash_old" \
  "forge forge 20260903T103000Z 2026-09-03T10:30:00Z $pair_hash_forge_new"; do
  read -r pair_host pair_profile pair_stamp pair_created pair_hash <<< "$spec"
  pair_snapshot="${pair_host}-${pair_stamp}"
  pair_file="$pair_icloud/manifests/2026-Q3/${pair_snapshot}.complete.json"
  jq --arg host "$pair_host" --arg profile "$pair_profile" --arg snapshot "$pair_snapshot" \
    --arg created "$pair_created" --arg hash "$pair_hash" '
      .host=$host | .profile=$profile | .snapshotId=$snapshot |
      .createdAt=$created | .uploadedVerifiedAt=$created | .forgeControlPlaneSha256=$hash
    ' "$dr_root/tests/fixtures/completion-manifest.valid.json" > "$pair_file"
  dr_sign_file "$temporary/signing-key" deniz-dr-complete "$pair_file" "${pair_file}.sig"
done
{
  printf 'DR_LOCAL_CACHE=%q\nDR_ICLOUD_ROOT=%q\n' "$pair_cache" "$pair_icloud"
  printf 'DR_ALLOWED_SIGNERS=%s\nDR_COMPLETION_SIGNER=test-signer\n' "$temporary/allowed-signers"
} > "$pair_config"
chmod 0600 "$pair_config"
pair_output="$(DR_ICLOUD_HELPER=/usr/bin/true "$dr_root/macos/dr-sync" --config "$pair_config" select-pair)"
jq -e --arg hash "$pair_hash_old" '
  .paired==true and .forgeControlPlaneSha256==$hash and
  .pi.snapshotId=="pi-cloud-20260903T080000Z" and
  .forge.snapshotId=="forge-20260903T083000Z" and
  .pi.forgeControlPlaneSha256==$hash and .forge.forgeControlPlaneSha256==$hash
' <<< "$pair_output" >/dev/null \
  || dr_die "Mac bridge did not choose the newest compatible signed Pi/Forge pair"

hydrate_root="$temporary/hydrate"
hydrate_icloud="$hydrate_root/Library/Mobile Documents/com~apple~CloudDocs/DR"
hydrate_cache="$hydrate_root/cache"
hydrate_config="$hydrate_root/config.env"
hydrate_snapshot=pi-cloud-20260903T070000Z
hydrate_repo="$hydrate_icloud/pi-cloud/2026-Q3/repository"
hydrate_ready="$hydrate_icloud/pi-cloud/2026-Q3/ready/${hydrate_snapshot}.json"
hydrate_completion="$hydrate_icloud/manifests/2026-Q3/${hydrate_snapshot}.complete.json"
mkdir -p "$hydrate_repo" "$(dirname "$hydrate_ready")" "$(dirname "$hydrate_completion")" \
  "$hydrate_cache" "$hydrate_root/output" "$hydrate_root/fake-bin"
printf 'encrypted-restic-config\n' > "$hydrate_repo/config"
hydrate_object_sha="$(dr_sha256 "$hydrate_repo/config")"
hydrate_object_bytes="$(wc -c < "$hydrate_repo/config" | tr -d ' ')"
jq --arg snapshot "$hydrate_snapshot" --arg sha "$hydrate_object_sha" --argjson bytes "$hydrate_object_bytes" '
  .createdAt="2026-09-03T07:00:00Z" | .snapshotId=$snapshot |
  .objects=[{path:"config",bytes:$bytes,sha256:$sha}]
' "$dr_root/tests/fixtures/ready-manifest.valid.json" > "$hydrate_ready"
dr_sign_file "$temporary/signing-key" deniz-dr-ready "$hydrate_ready" "${hydrate_ready}.sig"
hydrate_ready_sha="$(dr_sha256 "$hydrate_ready")"
jq -n --arg snapshot "$hydrate_snapshot" --arg readySha "$hydrate_ready_sha" \
  --arg sha "$hydrate_object_sha" --argjson bytes "$hydrate_object_bytes" \
  --arg forgeControlPlaneSha256 "$(jq -er .forgeControlPlaneSha256 "$hydrate_ready")" '
  {schemaVersion:1,createdAt:"2026-09-03T07:05:00Z",snapshotId:$snapshot,host:"pi-cloud",profile:"pi",
   generation:"2026-Q3",readySha256:$readySha,forgeControlPlaneSha256:$forgeControlPlaneSha256,
   objects:[{path:"config",bytes:$bytes,sha256:$sha}],
   uploadedVerifiedAt:"2026-09-03T07:05:00Z"}
' > "$hydrate_completion"
dr_sign_file "$temporary/signing-key" deniz-dr-complete "$hydrate_completion" "${hydrate_completion}.sig"
printf 'test-restic-password\n' > "$hydrate_root/restic-password"
chmod 0600 "$hydrate_root/restic-password"
ln -s /usr/bin/true "$hydrate_root/fake-bin/restic"
{
  printf 'DR_LOCAL_CACHE=%q\nDR_ICLOUD_ROOT=%q\n' "$hydrate_cache" "$hydrate_icloud"
  printf 'DR_ALLOWED_SIGNERS=%s\nDR_COMPLETION_SIGNER=test-signer\nDR_HOST_SIGNER_PI=test-signer\n' "$temporary/allowed-signers"
  printf 'DR_RESTIC_PASSWORD_FILE_PI=%s\n' "$hydrate_root/restic-password"
} > "$hydrate_config"
chmod 0600 "$hydrate_config"
hydrate_destination="$hydrate_root/output/verified"
hydrate_output="$(PATH="$hydrate_root/fake-bin:$PATH" DR_ICLOUD_HELPER=/usr/bin/true \
  "$dr_root/macos/dr-sync" --config "$hydrate_config" hydrate --host pi-cloud \
  --snapshot "$hydrate_snapshot" --destination "$hydrate_destination")"
jq -e --arg path "$hydrate_destination" \
  '.hydrated==true and .verified==true and .path==$path and .resticSnapshotId=="abcdef0123456789"' \
  <<< "$hydrate_output" >/dev/null
[[ -f "$hydrate_destination/repository/config" &&
   -z "$(find "$hydrate_root/output" -maxdepth 1 -name 'verified.partial.*' -print -quit)" ]] \
  || dr_die "hydration did not atomically publish its verified destination"

oversized_snapshot=pi-cloud-20260903T080000Z
oversized_completion="$hydrate_icloud/manifests/2026-Q3/${oversized_snapshot}.complete.json"
jq -n --arg snapshot "$oversized_snapshot" '
  {schemaVersion:1,createdAt:"2026-09-03T08:05:00Z",snapshotId:$snapshot,host:"pi-cloud",profile:"pi",
   generation:"2026-Q3",readySha256:"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
   forgeControlPlaneSha256:"fcb62420a9184c5b6cd274fc89599f2f9e0c02d284dce82dd18ec5a3d69fe02f",
   objects:[{path:"config",bytes:9000000000000000,sha256:"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}],
   uploadedVerifiedAt:"2026-09-03T08:05:00Z"}
' > "$oversized_completion"
dr_sign_file "$temporary/signing-key" deniz-dr-complete "$oversized_completion" "${oversized_completion}.sig"
oversized_destination="$hydrate_root/output/insufficient"
if PATH="$hydrate_root/fake-bin:$PATH" DR_ICLOUD_HELPER=/usr/bin/true \
  "$dr_root/macos/dr-sync" --config "$hydrate_config" hydrate --host pi-cloud \
  --snapshot "$oversized_snapshot" --destination "$oversized_destination" >/dev/null 2>&1; then
  dr_die "hydration accepted an impossible local capacity requirement"
fi
[[ ! -e "$oversized_destination" && -z "$(find "$hydrate_root/output" -maxdepth 1 -name 'insufficient.partial.*' -print -quit)" ]] \
  || dr_die "hydration created destination state before its free-space preflight passed"

printf 'test-restic-password\n' > "$temporary/restic-password"
chmod 0600 "$temporary/restic-password"
check_output="$(
  DR_RESTIC_PASSWORD_FILE="$temporary/restic-password" \
  DR_SIGNING_KEY="$temporary/signing-key" \
  DR_REMOTE_ROOT="$temporary/remote" \
  "$dr_root/backup" --profile pi --check-only
)"
jq -e '.ready==true and .writes==false and .profile=="pi"' <<< "$check_output" >/dev/null

cp "$dr_root/tests/fixtures/recovery-report.valid.json" "$temporary/invalid-report.json"
jq 'del(.target)' "$temporary/invalid-report.json" > "$temporary/invalid-report.tmp"
mv -- "$temporary/invalid-report.tmp" "$temporary/invalid-report.json"
if (dr_validate_json "$dr_root/schemas/recovery-report.schema.json" "$temporary/invalid-report.json") >/dev/null 2>&1; then
  dr_die "runtime schema guard accepted a missing required field"
fi

forge_domain='replace-forge-deployment.denizlg24.com'
jq -e --argjson domains "[\"$forge_domain\"]" -f "$dr_root/lib/forge-external-state.jq" \
  "$dr_root/external-state.example.json" >/dev/null \
  || dr_die "Forge external-state contract rejected the reviewed example"
jq 'del(.healthUrls[] | select(.profiles | index("forge")))' \
  "$dr_root/external-state.example.json" > "$temporary/forge-missing-health.json"
if jq -e --argjson domains "[\"$forge_domain\"]" -f "$dr_root/lib/forge-external-state.jq" \
  "$temporary/forge-missing-health.json" >/dev/null 2>&1; then
  dr_die "Forge external-state contract accepted a domain without external health"
fi
jq 'del(.records[] | select(.profiles | index("forge")))' \
  "$dr_root/external-state.example.json" > "$temporary/forge-missing-dns.json"
if jq -e --argjson domains "[\"$forge_domain\"]" -f "$dr_root/lib/forge-external-state.jq" \
  "$temporary/forge-missing-dns.json" >/dev/null 2>&1; then
  dr_die "Forge external-state contract accepted a domain without managed DNS"
fi

printf 'DR contract tests passed\n'
