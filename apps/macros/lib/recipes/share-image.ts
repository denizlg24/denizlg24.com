export const RECIPE_ROUTE_SEGMENT = "/(site)/recipes/[id]";

/**
 * Next serves a metadata image under a route group at a suffixed path, the
 * suffix being a djb2 hash of the segment, so `/recipes/<id>/opengraph-image`
 * does not exist. The test pins this to Next's own normalisation.
 */
export function metadataRouteSuffix(segment: string) {
  let hash = 5381;
  for (let index = 0; index < segment.length; index++) {
    hash = ((hash << 5) + hash + segment.charCodeAt(index)) & 0xffffffff;
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

const OG_IMAGE_SEGMENT = `opengraph-image-${metadataRouteSuffix(RECIPE_ROUTE_SEGMENT)}`;

export function recipeShareImagePath(recipeId: string) {
  return `/recipes/${recipeId}/${OG_IMAGE_SEGMENT}`;
}
