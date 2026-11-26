import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 127],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");

function expand(address: string) {
  const [head = "", tail = ""] = address.split("::");
  const parts = (text: string) => (text ? text.split(":") : []);
  const left = parts(head);
  const right = parts(tail);
  const last = right.at(-1) ?? left.at(-1) ?? "";
  // A trailing dotted quad occupies two groups.
  const dotted = last.includes(".") ? 1 : 0;
  const fill = address.includes("::")
    ? 8 - left.length - right.length - dotted
    : 0;
  return [...left, ...Array<string>(Math.max(0, fill)).fill("0"), ...right];
}

/** True for anything that isn't a routable public unicast address. */
export function restricted(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return blocked.check(address, "ipv4");
  if (version !== 6) return true;
  const groups = expand(address.toLowerCase());
  const mapped =
    groups.length >= 7 &&
    groups.slice(0, 5).every((group) => Number.parseInt(group, 16) === 0) &&
    (groups[5] === "ffff" || Number.parseInt(groups[5] ?? "", 16) === 0);
  if (mapped) {
    const last = groups.at(-1) ?? "";
    if (last.includes(".")) return restricted(last);
    const high = Number.parseInt(groups[6] ?? "", 16);
    const low = Number.parseInt(groups[7] ?? "", 16);
    if (Number.isNaN(high) || Number.isNaN(low)) return true;
    return restricted([high >> 8, high & 255, low >> 8, low & 255].join("."));
  }
  return blocked.check(address, "ipv6");
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, found) => {
    if (error) return callback(error, "", 4);
    const addresses = found as LookupAddress[];
    const bad =
      !addresses.length || addresses.some((item) => restricted(item.address));
    if (bad)
      return callback(
        new Error("That address points to a private network."),
        "",
        4,
      );
    if (options.all) return callback(null, addresses);
    const [first] = addresses;
    callback(null, first!.address, first!.family);
  });
};

/**
 * POSTs to a user-supplied HTTPS URL. Every address is vetted at connect
 * time, so DNS rebinding between a check and the request is impossible.
 * Redirects are not followed and response bodies are never surfaced.
 */
export function publicPost(
  target: string,
  headers: Record<string, string>,
  body: string,
): Promise<number> {
  const url = new URL(target);
  if (url.protocol !== "https:")
    return Promise.reject(new Error("Only https addresses are allowed."));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && restricted(host))
    return Promise.reject(
      new Error("That address points to a private network."),
    );
  return new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: "POST",
        lookup: guardedLookup,
        timeout: 10_000,
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    outgoing.on("timeout", () =>
      outgoing.destroy(new Error("The endpoint did not answer in time.")),
    );
    outgoing.on("error", (error) =>
      reject(
        /private network|in time/.test(error.message)
          ? error
          : new Error("Could not reach the endpoint."),
      ),
    );
    outgoing.end(body);
  });
}
