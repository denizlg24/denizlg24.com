import { requireOptionalNativeModule } from "expo";

interface StreamTvModule {
  tapCenter(viewTag: number): Promise<boolean>;
  publishWatching(items: string): boolean;
}

/** Android only; null on iOS and in Expo Go. */
const native = requireOptionalNativeModule<StreamTvModule>("StreamTv");

/** A real tap at the middle of a native view; false when it cannot. */
export async function tapCenter(viewTag: number | null): Promise<boolean> {
  if (!native || viewTag === null) return false;
  return native.tapCenter(viewTag).catch(() => false);
}

/**
 * Hands the TV home screen (`apps/tv-launcher`) what is in progress. False
 * where there is no such launcher to tell: phones, iOS, Android before 14.
 */
export function publishWatching(items: readonly unknown[]): boolean {
  if (!native) return false;
  try {
    return native.publishWatching(JSON.stringify(items));
  } catch {
    return false;
  }
}
