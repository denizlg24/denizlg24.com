#!/usr/bin/env bash

# The verifier shares a 4 GiB Pi with production. MongoDB's host-sized cache
# plus parallel index builds can kill the restore before READY publication.
# The full production index inventory also exceeds Docker's default 1024
# descriptors: WiredTiger panics with EMFILE unless the limit is explicit.
# Use this same budget in production and in the database round-trip test.
dr_start_mongo_verifier() {
  local name="$1" image="$2" data="$3"
  docker run -d --name "$name" --network none --user 0:0 \
    --memory 1024m --memory-swap 2048m --cpus 1 --ulimit nofile=65536:65536 \
    --mount "type=bind,source=${data},target=/data/db" --tmpfs /tmp \
    "$image" mongod --bind_ip_all --quiet --wiredTigerCacheSizeGB 0.25 \
    --setParameter diagnosticDataCollectionEnabled=false \
    --setParameter maxIndexBuildMemoryUsageMegabytes=64 \
    --setParameter maxNumActiveUserIndexBuilds=1
}

dr_restore_mongo_archive() {
  local name="$1" archive="$2" status=0
  docker exec -i "$name" mongorestore --archive --gzip --oplogReplay --drop \
    --stopOnError --numParallelCollections=1 --numInsertionWorkersPerCollection=1 \
    < "$archive" >/dev/null || status=$?
  if ((status != 0)); then
    # Preserve the cause before EXIT cleanup removes the disposable verifier.
    docker inspect --format 'MongoDB verifier: OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}} Error={{.State.Error}}' \
      "$name" >&2 || true
    docker logs --tail 50 "$name" >&2 || true
    return "$status"
  fi
}
