import { describe, expect, test } from "bun:test";
import { guideCrop } from "./label-crop";

const view = { width: 390, height: 844 };
const region = { x: 45, y: 228, width: 300, height: 375 };

describe("guideCrop", () => {
  test("maps the frame onto a photo already cropped to the preview", () => {
    // iOS crops the capture to the preview's aspect ratio: 3 px per point.
    const crop = guideCrop({ width: 1170, height: 2532 }, view, region);
    expect(crop).toEqual({
      originX: 45,
      originY: 571,
      width: 1080,
      height: 1350,
    });
  });

  test("accounts for the overflow of an aspect-filled 4:3 photo", () => {
    // 3024×4032 covers 390×844 at scale 844/4032; the sides overflow.
    const crop = guideCrop({ width: 3024, height: 4032 }, view, region);
    const scale = 844 / 4032;
    const offsetX = (3024 * scale - 390) / 2;
    expect(crop?.originX).toBe(Math.floor((45 - 30 + offsetX) / scale));
    expect(crop?.originY).toBe(Math.floor((228 - 37.5) / scale));
    expect(crop?.height).toBeLessThanOrEqual(4032);
  });

  test("clamps the margin to the photo", () => {
    const crop = guideCrop({ width: 390, height: 844 }, view, {
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    });
    expect(crop).toEqual({ originX: 0, originY: 0, width: 390, height: 844 });
  });

  test("leaves a photo whose orientation disagrees with the view uncropped", () => {
    expect(guideCrop({ width: 4032, height: 3024 }, view, region)).toBeNull();
  });

  test("leaves the photo alone before anything is measured", () => {
    expect(
      guideCrop({ width: 3024, height: 4032 }, { width: 0, height: 0 }, region),
    ).toBeNull();
  });
});
