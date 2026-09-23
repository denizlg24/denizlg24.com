import { describe, expect, test } from "bun:test";
import { isPrivateAddress } from "./private-address";

describe("isPrivateAddress", () => {
  test.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::192.168.0.1",
    "fe80::1%eth0",
    "192.88.99.1",
    "2002:c0a8:1::1",
    "2002:7f00:1::1",
    "2001::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
  ])("refuses %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  test.each([
    "1.1.1.1",
    "8.8.8.8",
    "172.32.0.1",
    "172.15.255.255",
    "100.128.0.1",
    "100.63.255.255",
    "192.169.0.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:1.1.1.1",
    "64:ff9b::1.1.1.1",
    "2002:0101:0101::1",
  ])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  test("anything that is not an address is refused", () => {
    expect(isPrivateAddress("example.com")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
    expect(isPrivateAddress("1.2.3")).toBe(true);
  });
});
