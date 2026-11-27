import { describe, expect, it } from "bun:test";
import { sniffPicture } from "./picture-format";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("sniffPicture", () => {
  it("reads WebP, JPEG and PNG from their signatures", () => {
    expect(
      sniffPicture(
        bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50),
      ),
    ).toBe("image/webp");
    expect(sniffPicture(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(
      sniffPicture(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("image/png");
  });

  it("refuses anything else, whatever it claims to be", () => {
    expect(sniffPicture(new TextEncoder().encode("<svg onload=x>"))).toBeNull();
    expect(
      sniffPicture(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49)),
    ).toBeNull();
    expect(sniffPicture(bytes())).toBeNull();
  });
});
