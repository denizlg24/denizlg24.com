export const DAV_NS = "DAV:";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

export interface DavPropName {
  ns: string;
  name: string;
}

export interface DavProp extends DavPropName {
  /** Pre-serialized inner XML. Text values must already be escaped. */
  value?: string;
}

export type PropfindRequest =
  | { mode: "allprop" }
  | { mode: "propname" }
  | { mode: "prop"; props: DavPropName[] };

/**
 * Resolves the prefix declarations on the request. Clients spell the same
 * namespace every possible way — `<D:prop>`, `<d:prop>`, `<prop xmlns="DAV:">`
 * — and Windows mixes in `urn:schemas-microsoft-com:` properties that have to
 * be echoed back under their own namespace to be reported as absent.
 */
function namespaceMap(xml: string): {
  prefixes: Map<string, string>;
  defaultNs: string;
} {
  const prefixes = new Map<string, string>();
  let defaultNs = DAV_NS;
  for (const match of xml.matchAll(/xmlns(?::([\w.-]+))?\s*=\s*"([^"]*)"/g)) {
    const prefix = match[1];
    const uri = match[2] ?? "";
    if (prefix) {
      prefixes.set(prefix, uri);
    } else if (uri) {
      defaultNs = uri;
    }
  }
  return { prefixes, defaultNs };
}

export function parsePropfind(body: string): PropfindRequest {
  const trimmed = body.trim();
  // An empty body means allprop (RFC 4918 §9.1). Finder sends one on mount.
  if (!trimmed) return { mode: "allprop" };
  if (/<(?:[\w.-]+:)?propname\b/i.test(trimmed)) return { mode: "propname" };
  const propBlock = trimmed.match(
    /<(?:[\w.-]+:)?prop(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?prop\s*>/i,
  )?.[1];
  if (!propBlock) return { mode: "allprop" };
  const { prefixes, defaultNs } = namespaceMap(trimmed);
  const props: DavPropName[] = [];
  for (const match of propBlock.matchAll(
    /<([\w.-]+:)?([\w.-]+)(?:\s[^>]*?)?\/?>/g,
  )) {
    const prefix = match[1]?.slice(0, -1);
    const name = match[2];
    if (!name) continue;
    const ns = prefix ? (prefixes.get(prefix) ?? DAV_NS) : defaultNs;
    if (!props.some((prop) => prop.ns === ns && prop.name === name)) {
      props.push({ ns, name });
    }
  }
  return props.length > 0 ? { mode: "prop", props } : { mode: "allprop" };
}

class NamespaceAllocator {
  readonly #prefixes = new Map<string, string>([[DAV_NS, "D"]]);
  #next = 1;

  prefixFor(ns: string): string {
    const existing = this.#prefixes.get(ns);
    if (existing) return existing;
    const prefix = `N${this.#next}`;
    this.#next += 1;
    this.#prefixes.set(ns, prefix);
    return prefix;
  }

  declarations(): string {
    let output = "";
    for (const [ns, prefix] of this.#prefixes) {
      if (prefix === "D") continue;
      output += ` xmlns:${prefix}="${escapeXml(ns)}"`;
    }
    return output;
  }
}

function renderProp(prop: DavProp, allocator: NamespaceAllocator): string {
  const tag = `${allocator.prefixFor(prop.ns)}:${prop.name}`;
  return prop.value ? `<${tag}>${prop.value}</${tag}>` : `<${tag}/>`;
}

export interface DavPropstat {
  status: string;
  props: DavProp[];
}

export interface DavResponseEntry {
  href: string;
  propstats: DavPropstat[];
}

export const STATUS_OK = "HTTP/1.1 200 OK";
export const STATUS_NOT_FOUND = "HTTP/1.1 404 Not Found";
export const STATUS_FORBIDDEN = "HTTP/1.1 403 Forbidden";

export function buildMultistatus(entries: DavResponseEntry[]): string {
  const allocator = new NamespaceAllocator();
  // Bodies render first so every namespace an entry pulled in is known by the
  // time the root element declares them.
  const rendered = entries
    .map((entry) => {
      const propstats = entry.propstats
        .filter((propstat) => propstat.props.length > 0)
        .map((propstat) => {
          const props = propstat.props
            .map((prop) => renderProp(prop, allocator))
            .join("");
          return `<D:propstat><D:prop>${props}</D:prop><D:status>${escapeXml(
            propstat.status,
          )}</D:status></D:propstat>`;
        })
        .join("");
      return `<D:response><D:href>${escapeXml(
        entry.href,
      )}</D:href>${propstats}</D:response>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:"${allocator.declarations()}>${rendered}</D:multistatus>`;
}
