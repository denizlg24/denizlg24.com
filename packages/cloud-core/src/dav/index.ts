export {
  DAV_REALM,
  type DavAuthResolver,
  type DavAuthThrottle,
  davAuth,
} from "./auth";
export {
  clearDavVerificationCache,
  generateDavSecret,
  type IssuedDavCredential,
  issueDavCredential,
  listDavCredentials,
  resolveDavCredential,
  revokeDavCredential,
  type SafeDavCredential,
} from "./credentials";
export {
  type DavLock,
  DavLockStore,
  parseIfHeader,
  parseTimeoutHeader,
} from "./locks";
export {
  DAV_HOME,
  DAV_SHARED,
  davHref,
  davPathToStorage,
  destinationPath,
  storagePathToDav,
} from "./mapping";
export { isOsMetadataName, isOsMetadataPath } from "./os-metadata";
export {
  buildPropstats,
  type DavResource,
  type PropertyContext,
} from "./properties";
export {
  DAV_METHODS,
  type DavRoutesOptions,
  type DavStorage,
  type DavVariables,
  davRoutes,
} from "./routes";
// `escapeXml` is deliberately not re-exported: the S3 module already exports a
// symbol by that name through the same barrel.
export {
  buildMultistatus,
  type PropfindRequest,
  parsePropfind,
} from "./xml";
