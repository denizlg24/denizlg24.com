#!/bin/bash

set -euo pipefail

umask 077

mode="--dry-run"
mode_set=false
action=""
run_id=""
generation=""
bytes="1048576"
target="payload"
expected_generations=""
iterations="25"
delay_ms="10"
hold_ms="5000"

usage() {
  cat >&2 <<'EOF'
Usage: posix-gate1-peer-container.sh [--dry-run|--execute] --action ACTION --run-id UUID [options]

Runs the bounded POSIX concurrency peer in the exact deployed API image. The
SMB client must first create Personal/posix-gate1-disposable-UUID and its exact
.posix-gate1-disposable marker. No production branch is mounted directly.

Options: --generation NAME --bytes N --target payload|renamed
         --expected-generations A,B --iterations N --delay-ms N --hold-ms N
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --dry-run|--execute)
      if [[ "$mode_set" == "true" ]]; then usage; exit 2; fi
      mode="$1"
      mode_set=true
      shift
      ;;
    --action|--run-id|--generation|--bytes|--target|--expected-generations|--iterations|--delay-ms|--hold-ms)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      case "$1" in
        --action) action="$2" ;;
        --run-id) run_id="$2" ;;
        --generation) generation="$2" ;;
        --bytes) bytes="$2" ;;
        --target) target="$2" ;;
        --expected-generations) expected_generations="$2" ;;
        --iterations) iterations="$2" ;;
        --delay-ms) delay_ms="$2" ;;
        --hold-ms) hold_ms="$2" ;;
      esac
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

case "$action" in
  seed|atomic-replace|rename|unlink|hold-read|snapshot-loop|inject-test-link) ;;
  *) echo "Invalid peer action" >&2; exit 2 ;;
esac
if [[ ! "$run_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Run ID must be a canonical UUID" >&2
  exit 2
fi
if [[ -n "$generation" && ! "$generation" =~ ^[A-Z0-9_-]{1,16}$ ]]; then
  echo "Generation is invalid" >&2
  exit 2
fi
if [[ -n "$expected_generations" && ! "$expected_generations" =~ ^[A-Z0-9_-]{1,16}(,[A-Z0-9_-]{1,16}){0,3}$ ]]; then
  echo "Expected generations are invalid" >&2
  exit 2
fi
for value in "$bytes" "$iterations" "$delay_ms" "$hold_ms"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "Numeric peer option is invalid" >&2; exit 2; }
done
[[ "$target" == "payload" || "$target" == "renamed" ]] || { echo "Peer target is invalid" >&2; exit 2; }

peer_bundle="${POSIX_GATE1_PEER_BUNDLE:-/tmp/posix-gate1-peer.js}"
merged_root="${POSIX_GATE1_MERGED_ROOT:-/var/lib/deniz-cloud/posix-gate1/mounts/merged}"
evidence_dir="${POSIX_GATE1_PEER_EVIDENCE_DIR:-/tmp/posix-gate1-peer-evidence-${run_id}}"
control_dir="${POSIX_GATE1_PEER_CONTROL_DIR:-/tmp/posix-gate1-control-${run_id}}"
peer_root="/gate1/personal/posix-gate1-disposable-${run_id}"

if [[ "$merged_root" != "/var/lib/deniz-cloud/posix-gate1/mounts/merged" \
  || "$peer_bundle" != "/tmp/posix-gate1-peer.js" \
  || "$evidence_dir" != "/tmp/posix-gate1-peer-evidence-${run_id}" \
  || "$control_dir" != "/tmp/posix-gate1-control-${run_id}" ]]; then
  echo "Gate 1 peer paths must use the fixed disposable locations" >&2
  exit 1
fi

if [[ "$mode" == "--dry-run" ]]; then
  jq -n --arg action "$action" --arg runId "$run_id" --arg root "$peer_root" \
    --arg evidence "$evidence_dir/events.jsonl" --arg control "$control_dir" \
    '{mode:"dry-run",action:$action,runId:$runId,containerRoot:$root,evidence:$evidence,controlDir:(if $action=="hold-read" then $control else null end),writes:false,productionBranchesMounted:false}'
  exit 0
fi

for command in chmod docker jq mkdir; do
  command -v "$command" >/dev/null || { echo "Required command is missing: ${command}" >&2; exit 1; }
done
if [[ ! -f "$peer_bundle" || -L "$peer_bundle" ]]; then
  echo "Gate 1 peer bundle is missing or unsafe" >&2
  exit 1
fi
if [[ -e "$evidence_dir" || -L "$evidence_dir" ]]; then
  if [[ ! -d "$evidence_dir" || -L "$evidence_dir" ]]; then
    echo "Gate 1 peer evidence directory is unsafe" >&2
    exit 1
  fi
else
  mkdir -m 700 "$evidence_dir"
fi

peer_args=(
  --execute
  --action "$action"
  --root "$peer_root"
  --run-id "$run_id"
  --bytes "$bytes"
  --target "$target"
  --iterations "$iterations"
  --delay-ms "$delay_ms"
  --hold-ms "$hold_ms"
  --log /evidence/events.jsonl
)
[[ -n "$generation" ]] && peer_args+=(--generation "$generation")
[[ -n "$expected_generations" ]] && peer_args+=(--expected-generations "$expected_generations")

mount_args=(
  --mount "type=bind,source=${peer_bundle},target=/gate1-peer.js,readonly"
  --mount "type=bind,source=${merged_root},target=/gate1"
  --mount "type=bind,source=${evidence_dir},target=/evidence"
)
if [[ "$action" == "hold-read" ]]; then
  if [[ -e "$control_dir" || -L "$control_dir" ]]; then
    echo "Refusing to reuse a Gate 1 control directory" >&2
    exit 1
  fi
  mkdir -m 700 "$control_dir"
  printf '%s\n' "$run_id" > "$control_dir/.posix-gate1-control"
  chmod 600 "$control_dir/.posix-gate1-control"
  mount_args+=(--mount "type=bind,source=${control_dir},target=/control")
  peer_args+=(--control-dir /control)
fi

api_image="$(docker inspect --format '{{.Config.Image}}' deniz-cloud-api-1)"
[[ -n "$api_image" ]] || { echo "Could not resolve the deployed API image" >&2; exit 1; }

docker run --rm --network none --read-only --tmpfs /tmp --user 1000:1000 \
  "${mount_args[@]}" --entrypoint bun "$api_image" /gate1-peer.js "${peer_args[@]}"
