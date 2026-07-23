#!/bin/sh

set -eu

acl_file="${REDIS_ACL_FILE:-/data/users.acl}"
acl_dir="$(dirname "$acl_file")"

: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$acl_dir"
  find "$acl_dir" ! -user redis -exec chown redis:redis '{}' + || true
fi

umask 0077
mkdir -p "$acl_dir"

password_hash="$(printf '%s' "$REDIS_PASSWORD" | sha256sum | cut -d ' ' -f 1)"
default_rule="user default on #${password_hash} ~* &* +@all"
tmp_file="${acl_file}.tmp"

if [ -f "$acl_file" ]; then
  {
    printf '%s\n' "$default_rule"
    grep -v '^user default ' "$acl_file" || true
  } > "$tmp_file"
else
  printf '%s\n' "$default_rule" > "$tmp_file"
fi

mv "$tmp_file" "$acl_file"
chmod 600 "$acl_file" || true

set -- \
  redis-server \
  --appendonly yes \
  --aclfile "$acl_file" \
  --acllog-max-len 128 \
  --maxmemory "${REDIS_MAXMEMORY:-128mb}" \
  --maxmemory-policy allkeys-lru

case "${REDIS_TLS_MODE:-disabled}" in
  disabled)
    ;;
  allow)
    cp /run/db-tls/fullchain.pem /tmp/redis-fullchain.pem
    cp /run/db-tls/privkey.pem /tmp/redis-privkey.pem
    chmod 644 /tmp/redis-fullchain.pem
    chmod 600 /tmp/redis-privkey.pem
    chown redis:redis /tmp/redis-fullchain.pem /tmp/redis-privkey.pem
    set -- "$@" \
      --tls-port 6378 \
      --tls-cert-file /tmp/redis-fullchain.pem \
      --tls-key-file /tmp/redis-privkey.pem \
      --tls-ca-cert-file /tmp/redis-fullchain.pem
    ;;
  *)
    echo "REDIS_TLS_MODE must be disabled or allow" >&2
    exit 1
    ;;
esac

exec docker-entrypoint.sh "$@"
