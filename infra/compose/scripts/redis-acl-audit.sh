#!/bin/sh

set -eu

: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
export REDISCLI_AUTH="$REDIS_PASSWORD"

while true; do
  entries="$(redis-cli -h redis --json ACL LOG 128)"
  addresses="$(
    printf '%s\n' "$entries" |
      grep -o '"reason":"auth"[^}]*' |
      sed -n 's/.*addr=\(\[[^]]*\]\|[^ :"]*\):[0-9][0-9]*.*/\1/p' ||
      true
  )"

  if [ -n "$addresses" ]; then
    printf '%s\n' "$addresses" | while IFS= read -r address; do
      printf 'deniz-cloud redis authentication failed remote=%s\n' "$address"
    done
    redis-cli -h redis ACL LOG RESET >/dev/null
  fi

  sleep 5
done
