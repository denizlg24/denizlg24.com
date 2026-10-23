/// <reference types="expo/types" />

/** Metro resolves a bundled image to an asset id. */
declare module "*.png" {
  const asset: number;
  export default asset;
}
