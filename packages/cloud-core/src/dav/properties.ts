import type { DavLockStore } from "./locks";
import { renderActiveLock, SUPPORTED_LOCK_XML } from "./locks";
import {
  DAV_NS,
  type DavProp,
  type DavPropstat,
  escapeXml,
  type PropfindRequest,
  STATUS_NOT_FOUND,
  STATUS_OK,
} from "./xml";

export interface DavResource {
  href: string;
  /** Storage path, or null for the synthetic mount root. */
  storagePath: string | null;
  isCollection: boolean;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
  sizeBytes: number | null;
  mimeType: string | null;
  etag: string | null;
}

export interface PropertyContext {
  locks: DavLockStore;
  quotaUsedBytes: number | null;
  quotaAvailableBytes: number | null;
}

const COMMON_PROPS = [
  "resourcetype",
  "displayname",
  "getlastmodified",
  "creationdate",
  "supportedlock",
  "lockdiscovery",
];
const FILE_PROPS = ["getcontentlength", "getcontenttype", "getetag"];
const COLLECTION_PROPS = ["quota-used-bytes", "quota-available-bytes"];

export function supportedPropNames(resource: DavResource): string[] {
  return [
    ...COMMON_PROPS,
    ...(resource.isCollection ? COLLECTION_PROPS : FILE_PROPS),
  ];
}

/**
 * Returns the serialized value for a DAV: property, or undefined when this
 * resource does not carry it. An empty string is a real value — it renders as
 * an empty element, which is what `resourcetype` on a plain file must be.
 */
function davPropValue(
  name: string,
  resource: DavResource,
  context: PropertyContext,
): string | undefined {
  switch (name) {
    case "resourcetype":
      return resource.isCollection ? "<D:collection/>" : "";
    case "displayname":
      return escapeXml(resource.displayName);
    case "getlastmodified":
      return escapeXml(resource.updatedAt.toUTCString());
    case "creationdate":
      return escapeXml(resource.createdAt.toISOString());
    case "supportedlock":
      return SUPPORTED_LOCK_XML;
    case "lockdiscovery": {
      const lock = resource.storagePath
        ? context.locks.covering(resource.storagePath)
        : null;
      return lock ? renderActiveLock(lock, resource.href) : "";
    }
    case "getcontentlength":
      return resource.isCollection || resource.sizeBytes === null
        ? undefined
        : String(resource.sizeBytes);
    case "getcontenttype":
      return resource.isCollection
        ? undefined
        : escapeXml(resource.mimeType ?? "application/octet-stream");
    case "getetag":
      return resource.isCollection || !resource.etag
        ? undefined
        : escapeXml(`"${resource.etag}"`);
    case "quota-used-bytes":
      return resource.isCollection && context.quotaUsedBytes !== null
        ? String(context.quotaUsedBytes)
        : undefined;
    case "quota-available-bytes":
      return resource.isCollection && context.quotaAvailableBytes !== null
        ? String(context.quotaAvailableBytes)
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Splits the requested properties into the 200 and 404 blocks a multistatus
 * needs. Reporting an unknown property as 404 in its own propstat — rather than
 * failing the whole response — is what keeps Explorer's `Win32*` probes and
 * Finder's Apple-specific ones from turning into errors on the client.
 */
export function buildPropstats(
  resource: DavResource,
  request: PropfindRequest,
  context: PropertyContext,
): DavPropstat[] {
  if (request.mode === "propname") {
    return [
      {
        status: STATUS_OK,
        props: supportedPropNames(resource).map((name) => ({
          ns: DAV_NS,
          name,
        })),
      },
    ];
  }

  if (request.mode === "allprop") {
    const props: DavProp[] = [];
    for (const name of supportedPropNames(resource)) {
      const value = davPropValue(name, resource, context);
      if (value !== undefined) props.push({ ns: DAV_NS, name, value });
    }
    return [{ status: STATUS_OK, props }];
  }

  const found: DavProp[] = [];
  const missing: DavProp[] = [];
  for (const prop of request.props) {
    const value =
      prop.ns === DAV_NS
        ? davPropValue(prop.name, resource, context)
        : undefined;
    if (value === undefined) {
      missing.push({ ns: prop.ns, name: prop.name });
    } else {
      found.push({ ns: prop.ns, name: prop.name, value });
    }
  }
  return [
    { status: STATUS_OK, props: found },
    { status: STATUS_NOT_FOUND, props: missing },
  ];
}
