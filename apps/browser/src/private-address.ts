import { isIPv4, isIPv6 } from "node:net";

/**
 * Every range an internet-facing browser must never reach from inside the
 * tailnet: loopback, RFC 1918, link-local, the CGNAT block Tailscale hands
 * out, multicast, the benchmarking and reserved blocks. A resolved address is
 * tested here, never a hostname — the proxy resolves names itself so a DNS
 * answer that points inward is refused rather than connected to.
 */
const PRIVATE_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4ToInt(address: string): number {
  const octets = address.split(".").map(Number);
  return (
    (((octets[0] ?? 0) << 24) |
      ((octets[1] ?? 0) << 16) |
      ((octets[2] ?? 0) << 8) |
      (octets[3] ?? 0)) >>>
    0
  );
}

function inV4Block(address: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) >>> 0 === (v4ToInt(base) & mask) >>> 0;
}

function isPrivateV4(address: string): boolean {
  const value = v4ToInt(address);
  return PRIVATE_V4.some(([base, bits]) => inV4Block(value, base, bits));
}

/** Eight 16-bit groups, or null when the literal is not one we can read. */
function expandV6(address: string): number[] | null {
  let literal = address;
  const zone = literal.indexOf("%");
  if (zone !== -1) literal = literal.slice(0, zone);
  const lastColon = literal.lastIndexOf(":");
  const tail = literal.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIPv4(tail)) return null;
    const v4 = v4ToInt(tail);
    literal = `${literal.slice(0, lastColon)}:${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = literal.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array(missing).fill("0"), ...rest].map((group) =>
    Number.parseInt(group || "0", 16),
  );
  return groups.length === 8 && groups.every((group) => Number.isFinite(group))
    ? groups
    : null;
}

function isPrivateV6(address: string): boolean {
  const groups = expandV6(address);
  if (!groups) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
    groups;
  const embeddedV4 = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  // ::ffff:a.b.c.d (IPv4-mapped) and 64:ff9b::/96 (NAT64) carry a v4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0xffff) return isPrivateV4(embeddedV4);
    if (g5 === 0) return true; // :: and ::1 and the whole ::/96 compat block
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0) {
    return g5 === 0 ? isPrivateV4(embeddedV4) : false;
  }
  // 2002::/16 6to4 embeds the v4 address it tunnels to in the next two
  // groups, and 192.88.99.0/24 is its deprecated anycast relay (RFC 7526).
  // A host with a 6to4 route would otherwise reach inward through either.
  if (g0 === 0x2002) {
    return isPrivateV4(`${g1 >> 8}.${g1 & 0xff}.${g2 >> 8}.${g2 & 0xff}`);
  }
  if (g0 === 0x2001 && g1 === 0) return true; // 2001::/32 Teredo, same shape
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  return false;
}

/** True for any literal address the browser must not be allowed to connect to. */
export function isPrivateAddress(address: string): boolean {
  if (isIPv4(address)) return isPrivateV4(address);
  if (isIPv6(address)) return isPrivateV6(address);
  return true;
}
