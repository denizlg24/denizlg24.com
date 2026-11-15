#!/usr/bin/env bash
# stdout is only the verified address, so callers can safely export PI_ADDR.
set -euo pipefail

target_host="${1:?Usage: wait-tailnet-ssh.sh HOST [USER]}"
target_user="${2:-denizlg24}"
wait_seconds="${TAILNET_SSH_WAIT_SECONDS:-120}"
poll_seconds="${TAILNET_SSH_POLL_SECONDS:-5}"
[[ "$target_host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || { echo "Invalid tailnet host" >&2; exit 1; }
[[ "$target_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "Invalid SSH user" >&2; exit 1; }
[[ "$wait_seconds" =~ ^[0-9]{1,3}$ && "$poll_seconds" =~ ^[1-9][0-9]?$ ]] || {
  echo "Invalid tailnet SSH wait settings" >&2; exit 1;
}
wait_seconds=$((10#$wait_seconds))
poll_seconds=$((10#$poll_seconds))
readiness_deadline=$((SECONDS + wait_seconds))
error_log="$(mktemp)"
trap 'rm -f "$error_log"' EXIT
target_addr=""

while true; do
  # Netmap resolution alone also succeeds for offline peers. Re-resolve each
  # attempt and prove SSH works before taking any deployment fence.
  if target_addr="$(timeout --foreground 5s tailscale ip -4 "$target_host" 2>"$error_log")"; then
    if ! python3 -c 'import ipaddress, sys; sys.exit(0 if ipaddress.ip_address(sys.argv[1]) in ipaddress.ip_network("100.64.0.0/10") else 1)' "$target_addr" 2>/dev/null; then
      echo "Refusing non-tailnet IPv4 address for $target_host" >&2
      exit 1
    fi
    if timeout --foreground 8s ssh -o ConnectTimeout=5 -o ConnectionAttempts=1 \
      -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
      "${target_user}@${target_addr}" true > /dev/null 2>"$error_log"; then
      printf '%s\n' "$target_addr"
      exit 0
    fi
  fi
  if ((SECONDS >= readiness_deadline)); then break; fi
  echo "Waiting for SSH to $target_host (${target_addr:-unresolved})…" >&2
  remaining=$((readiness_deadline - SECONDS))
  if ((remaining <= 0)); then break; fi
  if ((remaining < poll_seconds)); then sleep "$remaining"; else sleep "$poll_seconds"; fi
done

echo "SSH to $target_host was unavailable after ${wait_seconds}s; deployment has not started." >&2
cat "$error_log" >&2
if peer_status="$(timeout --foreground 5s tailscale status --json 2>/dev/null)"; then
  printf '%s' "$peer_status" | python3 -c '
import json, sys
status = json.load(sys.stdin)
print("Tailscale backend:", status.get("BackendState", "unknown"), file=sys.stderr)
host, address = sys.argv[1:]
for peer in status.get("Peer", {}).values():
    if address in peer.get("TailscaleIPs", []) or host in (peer.get("HostName"), peer.get("DNSName", "").rstrip(".")):
        print(json.dumps({key: peer.get(key) for key in ("HostName", "Online", "LastSeen", "TailscaleIPs")}), file=sys.stderr)
' "$target_host" "$target_addr" || true
fi
echo "Check the target host power/network and tailscaled, then rerun the failed deployment job. No deployment lock was acquired." >&2
exit 1
