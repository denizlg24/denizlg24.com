#!/bin/bash

set -euo pipefail

umask 077

for command in findmnt ip jq ss uname; do
  if ! command -v "$command" >/dev/null; then
    echo "Required command is missing: ${command}" >&2
    exit 1
  fi
done

tailscale_ip="$(ip -4 -o address show dev tailscale0 2>/dev/null | awk 'NR == 1 {split($4, address, "/"); print address[1]}' || true)"
ssd_source="$(findmnt -T /mnt/ssd/storage -n -o SOURCE 2>/dev/null || true)"
hdd_source="$(findmnt -T /mnt/hdd/storage -n -o SOURCE 2>/dev/null || true)"
mergerfs_version="$(mergerfs --version 2>/dev/null | awk 'NR == 1 {sub(/^v/, "", $NF); print $NF}' || true)"
samba_version="$(smbd --version 2>/dev/null | awk 'NR == 1 {print $2}' || true)"
tcp445_listeners="$(ss -H -ltn 'sport = :445' | wc -l | tr -d ' ')"

requirements_json="$({
  for command in docker fallocate findmnt fusermount3 getfacl getfattr jq losetup mergerfs mkfs.ext4 mount mountpoint nft setfacl setfattr smbclient smbd smbstatus testparm truncate; do
    if command -v "$command" >/dev/null; then
      jq -nc --arg command "$command" '{command:$command,available:true}'
    else
      jq -nc --arg command "$command" '{command:$command,available:false}'
    fi
  done
} | jq -s '.')"

jq -n \
  --arg kernel "$(uname -r)" \
  --arg architecture "$(uname -m)" \
  --arg tailscaleIp "$tailscale_ip" \
  --arg ssdSource "$ssd_source" \
  --arg hddSource "$hdd_source" \
  --arg mergerfsVersion "$mergerfs_version" \
  --arg sambaVersion "$samba_version" \
  --argjson tcp445Listeners "$tcp445_listeners" \
  --argjson requirements "$requirements_json" \
  '{kernel:$kernel,architecture:$architecture,tailscaleIp:(if $tailscaleIp=="" then null else $tailscaleIp end),productionSources:{ssd:(if $ssdSource=="" then null else $ssdSource end),hdd:(if $hddSource=="" then null else $hddSource end)},versions:{mergerfs:(if $mergerfsVersion=="" then null else $mergerfsVersion end),samba:(if $sambaVersion=="" then null else $sambaVersion end)},tcp445Listeners:$tcp445Listeners,requirements:$requirements,ready:($tailscaleIp!="" and $mergerfsVersion=="2.42.0" and $sambaVersion!="" and $tcp445Listeners==0 and ([ $requirements[] | select(.available==false) ] | length)==0)}'
