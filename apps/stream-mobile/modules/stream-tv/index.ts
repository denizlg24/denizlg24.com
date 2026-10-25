import { requireOptionalNativeModule } from "expo";

interface StreamTvModule {
  tapCenter(viewTag: number): Promise<boolean>;
}

/** Android only; null on iOS and in Expo Go. */
const native = requireOptionalNativeModule<StreamTvModule>("StreamTv");

/** A real tap at the middle of a native view; false when it cannot. */
export async function tapCenter(viewTag: number | null): Promise<boolean> {
  if (!native || viewTag === null) return false;
  return native.tapCenter(viewTag).catch(() => false);
}
