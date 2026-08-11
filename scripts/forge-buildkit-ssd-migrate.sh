#!/usr/bin/env bash
# One-time, reversible migration of Forge's BuildKit state from HDD to SSD.
#
# Copy this file beside infra/systemd/forge-buildkit.service and
# infra/systemd/forge-buildkitd-ssd.toml on the host, then run it as root.
# It starts with an empty SSD cache and deliberately leaves the HDD cache
# untouched until the owner has validated several builds.

set -euo pipefail

MODE="${1:-status}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SOURCE="${FORGE_BUILDKIT_SERVICE_SOURCE:-${SCRIPT_DIR}/forge-buildkit.service}"
SSD_CONFIG_SOURCE="${FORGE_BUILDKIT_SSD_CONFIG_SOURCE:-${SCRIPT_DIR}/forge-buildkitd-ssd.toml}"

SSD_ROOT=/var/lib/forge-buildkit
STORAGE_ENV=/etc/forge/buildkit-storage.env
AGENT_ENV=/etc/forge/agent.env
SERVICE_TARGET=/etc/systemd/system/forge-buildkit.service
SSD_CONFIG_TARGET=/etc/forge/buildkitd-ssd.toml
HDD_CONFIG_TARGET=/etc/forge/buildkitd.toml
BACKUP_ROOT=/var/lib/forge-agent/ssd-migration-backup
MINIMUM_FREE_BYTES=100000000000

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "run with sudo" >&2
    exit 1
  fi
}

agent_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$AGENT_ENV"
}

agent_health() {
  local bind port
  bind="$(agent_value AGENT_BIND_ADDRESS)"
  port="$(agent_value AGENT_PORT)"
  port="${port:-4010}"
  curl -fsS --max-time 5 "http://${bind}:${port}/healthz"
}

assert_idle() {
  local health
  if ! health="$(agent_health 2>/dev/null)"; then
    echo "Forge health is unavailable; refusing a storage migration without an idle-queue check" >&2
    exit 1
  fi
  if ! grep -q '"running":0' <<<"$health" \
    || ! grep -q '"building":0' <<<"$health"; then
    echo "Forge still has an active deployment; wait for queue.running and queue.building to reach zero" >&2
    echo "$health" >&2
    exit 1
  fi
  if pgrep -f 'docker-buildx.*buildx build|nixpacks build' >/dev/null; then
    echo "a build process is still active even though the queue reports idle" >&2
    exit 1
  fi
}

set_agent_env() {
  local key="$1" value="$2" temporary
  temporary="$(mktemp /etc/forge/agent.env.XXXXXX)"
  awk -F= -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $1 == key { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$AGENT_ENV" > "$temporary"
  chown --reference="$AGENT_ENV" "$temporary"
  chmod --reference="$AGENT_ENV" "$temporary"
  mv -f "$temporary" "$AGENT_ENV"
}

backup_current() {
  if [ -e "$BACKUP_ROOT" ]; then
    echo "backup already exists at $BACKUP_ROOT; inspect or remove it before applying again" >&2
    exit 1
  fi
  install -d -o root -g root -m 0700 "$BACKUP_ROOT"
  cp -a "$SERVICE_TARGET" "$BACKUP_ROOT/forge-buildkit.service"
  cp -a "$HDD_CONFIG_TARGET" "$BACKUP_ROOT/forge-buildkitd.toml"
  cp -a "$AGENT_ENV" "$BACKUP_ROOT/forge-agent.env"
  if [ -e "$STORAGE_ENV" ]; then
    cp -a "$STORAGE_ENV" "$BACKUP_ROOT/buildkit-storage.env"
  else
    : > "$BACKUP_ROOT/buildkit-storage.env.absent"
  fi
}

restore_backup() {
  if [ ! -d "$BACKUP_ROOT" ]; then
    echo "no migration backup at $BACKUP_ROOT" >&2
    return 1
  fi
  systemctl stop forge-agent.service forge-buildkit.service 2>/dev/null || true
  cp -a "$BACKUP_ROOT/forge-buildkit.service" "$SERVICE_TARGET"
  cp -a "$BACKUP_ROOT/forge-buildkitd.toml" "$HDD_CONFIG_TARGET"
  cp -a "$BACKUP_ROOT/forge-agent.env" "$AGENT_ENV"
  if [ -e "$BACKUP_ROOT/buildkit-storage.env.absent" ]; then
    rm -f "$STORAGE_ENV"
  else
    cp -a "$BACKUP_ROOT/buildkit-storage.env" "$STORAGE_ENV"
  fi
  systemctl daemon-reload
  systemctl start forge-buildkit.service
  systemctl start forge-agent.service
}

archive_backup() {
  local reason="$1" archived
  archived="${BACKUP_ROOT}.${reason}-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$BACKUP_ROOT" "$archived"
  echo "migration backup archived at $archived"
}

show_status() {
  printf "services\n"
  systemctl is-active forge-buildkit.service forge-agent.service || true
  printf "storage profile\n"
  if [ -f "$STORAGE_ENV" ]; then
    sed -n -E '/^(BUILDKIT_DATA_ROOT|BUILDKIT_CONFIG_PATH)=/p' "$STORAGE_ENV"
  else
    echo "default HDD profile"
  fi
  printf "agent build settings\n"
  sed -n -E '/^(MAX_CONCURRENT_BUILDS|BUILDX_BUILDER|BUILDKIT_ENDPOINT|SERIALIZE_BUN_INSTALLS)=/p' "$AGENT_ENV"
  printf "space\n"
  df -h / /mnt/storage
  if docker inspect forge-buildkit >/dev/null 2>&1; then
    printf "worker mounts\n"
    docker inspect forge-buildkit \
      --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
  fi
}

apply_migration() {
  require_root
  [ -f "$SERVICE_SOURCE" ] || { echo "missing $SERVICE_SOURCE" >&2; exit 1; }
  [ -f "$SSD_CONFIG_SOURCE" ] || { echo "missing $SSD_CONFIG_SOURCE" >&2; exit 1; }
  [ -f "$AGENT_ENV" ] || { echo "missing $AGENT_ENV" >&2; exit 1; }
  [ -f "$SERVICE_TARGET" ] || { echo "missing $SERVICE_TARGET" >&2; exit 1; }
  [ -f "$HDD_CONFIG_TARGET" ] || { echo "missing $HDD_CONFIG_TARGET" >&2; exit 1; }
  mountpoint -q /mnt/storage || { echo "/mnt/storage is not mounted" >&2; exit 1; }

  local available
  available="$(df --output=avail -B1 / | tail -n 1 | tr -d ' ')"
  if [ "$available" -lt "$MINIMUM_FREE_BYTES" ]; then
    echo "SSD has only ${available} bytes available; at least ${MINIMUM_FREE_BYTES} are required" >&2
    exit 1
  fi

  assert_idle
  backup_current

  local rollback_needed=1
  automatic_rollback() {
    local status=$?
    if [ "$rollback_needed" = "1" ]; then
      echo "migration failed; restoring the HDD profile" >&2
      if restore_backup; then
        archive_backup failed
      fi
    fi
    exit "$status"
  }
  trap automatic_rollback ERR INT TERM

  # Stop the claimant first so the idle queue stays idle during the switch.
  systemctl stop forge-agent.service
  systemctl stop forge-buildkit.service

  install -d -o root -g root -m 0700 "$SSD_ROOT"
  install -o root -g root -m 0644 "$SERVICE_SOURCE" "$SERVICE_TARGET"
  install -o root -g root -m 0644 "$SSD_CONFIG_SOURCE" "$SSD_CONFIG_TARGET"
  {
    echo "BUILDKIT_DATA_ROOT=$SSD_ROOT"
    echo "BUILDKIT_CONFIG_PATH=$SSD_CONFIG_TARGET"
  } > "$STORAGE_ENV"
  chown root:root "$STORAGE_ENV"
  chmod 0644 "$STORAGE_ENV"

  set_agent_env MAX_CONCURRENT_BUILDS 2
  set_agent_env BUILDX_BUILDER forge-ssd
  set_agent_env BUILDKIT_ENDPOINT docker-container://forge-buildkit
  set_agent_env SERIALIZE_BUN_INSTALLS false

  systemctl daemon-reload
  systemctl start forge-buildkit.service
  for _ in $(seq 1 30); do
    systemctl is-active --quiet forge-buildkit.service && break
    sleep 1
  done
  systemctl is-active --quiet forge-buildkit.service

  # Type=simple becomes active as soon as the docker client starts; the daemon
  # may not have registered the container name yet. Wait for inspect rather
  # than treating that short startup window as a failed migration.
  local mounted_source=""
  for _ in $(seq 1 30); do
    if mounted_source="$(docker inspect forge-buildkit \
      --format '{{range .Mounts}}{{if eq .Destination "/var/lib/buildkit"}}{{.Source}}{{end}}{{end}}' \
      2>/dev/null)"; then
      break
    fi
    sleep 1
  done
  if [ "$mounted_source" != "$SSD_ROOT" ]; then
    echo "BuildKit mounted ${mounted_source:-nothing} instead of $SSD_ROOT" >&2
    return 1
  fi

  systemctl start forge-agent.service
  for _ in $(seq 1 30); do
    if agent_health >/dev/null 2>&1; then
      rollback_needed=0
      trap - ERR INT TERM
      echo "Forge now uses the empty SSD BuildKit cache at $SSD_ROOT"
      echo "HDD cache retained at /mnt/storage/forge/buildkit"
      echo "rollback backup retained at $BACKUP_ROOT"
      show_status
      return 0
    fi
    sleep 1
  done
  echo "Forge agent did not become healthy" >&2
  return 1
}

rollback_migration() {
  require_root
  assert_idle
  restore_backup
  archive_backup rolled-back
  echo "restored the HDD BuildKit profile; the SSD cache remains at $SSD_ROOT"
  show_status
}

case "$MODE" in
  apply)
    apply_migration
    ;;
  rollback)
    rollback_migration
    ;;
  status)
    require_root
    show_status
    ;;
  *)
    echo "usage: $0 {status|apply|rollback}" >&2
    exit 2
    ;;
esac
