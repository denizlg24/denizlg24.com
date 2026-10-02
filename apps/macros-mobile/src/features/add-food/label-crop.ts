export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface CropRect extends Size {
  originX: number;
  originY: number;
}

/**
 * Slack around the guide frame, as a share of its size. Android's preview
 * and capture need not share a field of view, and hands move between framing
 * and the shutter; clipping the table costs far more than a little packaging.
 */
const MARGIN = 0.1;

/**
 * Maps the on-screen guide frame onto the captured photo. The preview fills
 * its view (aspect fill, centred), so the photo is scaled until it covers the
 * view and the overflow is split evenly. Returns null — send the whole photo —
 * when the photo and the view disagree on orientation: the frame cannot be
 * placed then, and a wrong crop would cut the label.
 */
export function guideCrop(
  photo: Size,
  view: Size,
  region: Rect,
): CropRect | null {
  if (
    photo.width <= 0 ||
    photo.height <= 0 ||
    view.width <= 0 ||
    view.height <= 0
  ) {
    return null;
  }
  if (photo.width > photo.height !== view.width > view.height) return null;

  const scale = Math.max(view.width / photo.width, view.height / photo.height);
  const offsetX = (photo.width * scale - view.width) / 2;
  const offsetY = (photo.height * scale - view.height) / 2;
  const marginX = region.width * MARGIN;
  const marginY = region.height * MARGIN;

  const left = Math.max(0, (region.x - marginX + offsetX) / scale);
  const top = Math.max(0, (region.y - marginY + offsetY) / scale);
  const right = Math.min(
    photo.width,
    (region.x + region.width + marginX + offsetX) / scale,
  );
  const bottom = Math.min(
    photo.height,
    (region.y + region.height + marginY + offsetY) / scale,
  );
  if (right - left < 1 || bottom - top < 1) return null;

  const originX = Math.floor(left);
  const originY = Math.floor(top);
  return {
    originX,
    originY,
    width: Math.floor(right) - originX,
    height: Math.floor(bottom) - originY,
  };
}
