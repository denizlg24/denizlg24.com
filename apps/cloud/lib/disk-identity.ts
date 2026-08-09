import type { DiskInfo } from "@repo/schemas/cloud";

/**
 * How a disk is identified across samples.
 *
 * The filesystem UUID, because kernel names are assigned in probe order: the
 * same physical disk has answered to `sda1`, `sdc1` once a second disk joined
 * the pool, and `sda1` again after the next reboot. Anything keyed on the name
 * — a metric series, a selection, a React key — silently follows the name
 * rather than the disk.
 *
 * Falls back to the device path for samples written before the switch, and for
 * a host still configured with `/dev/...` values. This must stay identical to
 * the key the API writes in `sampler.ts`, or charts query a series that has no
 * points.
 */
export function diskSeriesKey(disk: Pick<DiskInfo, "device" | "uuid">): string {
  return disk.uuid ?? disk.device;
}

/** `/dev/nvme0n1p1` -> `nvme0n1p1`. */
export function shortDevice(device: string): string {
  return device.replace(/^\/dev\//, "");
}

/**
 * What to call a disk in the UI: the name it currently answers to, since that
 * is what `lsblk` and `dmesg` will agree with while someone is looking at the
 * rack. An absent device means the UUID resolved to nothing — the disk is
 * unplugged or its enclosure lost power — and there is no name to show.
 */
export function diskLabel(disk: Pick<DiskInfo, "device" | "uuid">): string {
  if (disk.device) return shortDevice(disk.device);
  return disk.uuid ? shortUuid(disk.uuid) : "unknown";
}

/** Enough UUID to tell two disks apart without spending a line on it. */
export function shortUuid(uuid: string): string {
  return uuid.split("-")[0] ?? uuid;
}
