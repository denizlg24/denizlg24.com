import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { altUserAgent } from "../http";
import { AltUnavailable } from "../types";
import { type Budget, spend } from "./pool";
import { ptrDocument } from "./schemas";
import {
  parseSenateListing,
  parseSenatePtr,
  type SenateListing,
  senateCsrf,
} from "./senate-parse";

export const SENATE = "https://efdsearch.senate.gov";
export const senateDocumentUrl = (path: string) => `${SENATE}${path}`;

type Session = { cookies: Map<string, string>; csrf: string; at: number };
let session: Session | null = null;
let opening: Promise<Session> | null = null;
const SESSION_MS = 20 * 60_000;

const remember = (jar: Map<string, string>, response: Response) => {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const at = pair.indexOf("=");
    if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
};
const cookieHeader = (jar: Map<string, string>) =>
  [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

async function send(url: string, init: RequestInit) {
  try {
    return await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      ...init,
    });
  } catch {
    throw new AltUnavailable("Senate eFD did not answer.");
  }
}

/** eFD requires accepting its terms: GET the form, POST the agreement, keep the cookies. */
async function open(): Promise<Session> {
  const jar = new Map<string, string>();
  const headers = { "User-Agent": altUserAgent(), Accept: "text/html" };
  const home = await send(`${SENATE}/search/home/`, { headers });
  if (!home.ok)
    throw new AltUnavailable(
      `Senate eFD returned HTTP ${home.status}.`,
      502,
      home.status >= 500,
    );
  remember(jar, home);
  const token = senateCsrf(await home.text());
  if (!token)
    throw new AltUnavailable("Senate eFD agreement form was not found.");
  const agreed = await send(`${SENATE}/search/home/`, {
    method: "POST",
    redirect: "manual",
    headers: {
      ...headers,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
      Referer: `${SENATE}/search/home/`,
    },
    body: new URLSearchParams({
      csrfmiddlewaretoken: token,
      prohibition_agreement: "1",
    }),
  });
  if (agreed.status >= 400)
    throw new AltUnavailable(
      `Senate eFD refused the agreement (HTTP ${agreed.status}).`,
    );
  remember(jar, agreed);
  const csrf = jar.get("csrftoken") ?? token;
  return { cookies: jar, csrf, at: Date.now() };
}

async function current(): Promise<Session> {
  if (session && Date.now() - session.at < SESSION_MS) return session;
  opening ??= open()
    .then((next) => {
      session = next;
      return next;
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}

async function authed(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const active = await current();
  const response = await send(`${SENATE}${path}`, {
    ...init,
    redirect: "manual",
    headers: {
      "User-Agent": altUserAgent(),
      Cookie: cookieHeader(active.cookies),
      Referer: `${SENATE}/search/`,
      "X-CSRFToken": active.csrf,
      ...init.headers,
    },
  });
  const expired = response.status === 302 || response.status === 403;
  if (expired && retry) {
    session = null;
    return authed(path, init, false);
  }
  if (!response.ok)
    throw new AltUnavailable(
      `Senate eFD returned HTTP ${response.status}.`,
      response.status === 404 ? 404 : 502,
      response.status >= 500,
    );
  return response;
}

const listingSchema = z.array(
  z.object({
    uuid: z.string(),
    kind: z.enum(["ptr", "paper", "annual", "other"]),
    first: z.string(),
    last: z.string(),
    filerType: z.string(),
    title: z.string(),
    filedAt: z.string(),
    path: z.string(),
  }),
);

const reportTypes = { ptr: 11, annual: 7 } as const;

async function search(
  type: keyof typeof reportTypes,
  since: Date,
): Promise<SenateListing[]> {
  const out: SenateListing[] = [];
  const start = `${String(since.getMonth() + 1).padStart(2, "0")}/${String(since.getDate()).padStart(2, "0")}/${since.getFullYear()} 00:00:00`;
  for (let offset = 0; offset < 3_000; offset += 100) {
    const active = await current();
    const response = await authed("/search/report/data/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        start: String(offset),
        length: "100",
        report_types: `[${reportTypes[type]}]`,
        filer_types: "[]",
        submitted_start_date: start,
        submitted_end_date: "",
        candidate_state: "",
        senator_state: "",
        office_id: "",
        first_name: "",
        last_name: "",
        "order[0][column]": "4",
        "order[0][dir]": "desc",
        csrfmiddlewaretoken: active.csrf,
      }),
    });
    const body = z
      .object({ data: z.array(z.array(z.string())) })
      .safeParse(await response.json().catch(() => null));
    if (!body.success)
      throw new AltUnavailable(
        "Senate eFD sent a response that is not the report list.",
      );
    for (const row of body.data.data) {
      const listing = parseSenateListing(row);
      if (listing) out.push(listing);
    }
    if (body.data.data.length < 100) break;
  }
  return out;
}

/** Electronic and paper PTRs submitted since the start of last year, newest first. */
export async function senatePtrList() {
  const since = new Date(new Date().getFullYear() - 1, 0, 1);
  return cached({
    source: "congress.senate.list",
    key: "ptr",
    ttlMs: 10 * 60_000,
    schema: listingSchema,
    load: () => search("ptr", since),
  });
}

export async function senateAnnualList() {
  const since = new Date(new Date().getFullYear() - 3, 0, 1);
  return cached({
    source: "congress.senate.list",
    key: "annual",
    ttlMs: 6 * 3_600_000,
    schema: listingSchema,
    load: () => search("annual", since),
  });
}

export async function senatePtr(listing: SenateListing, budget: Budget) {
  return cached({
    source: "congress.senate.ptr",
    key: `v1:${listing.uuid}`,
    ttlMs: Number.POSITIVE_INFINITY,
    schema: ptrDocument,
    load: async () => {
      if (listing.kind !== "ptr")
        return {
          parsed: false,
          reason: "paper filing, scanned image",
          trades: [],
        };
      spend(budget);
      const html = await (await authed(listing.path)).text();
      if (html.includes("prohibition_agreement")) {
        session = null;
        throw new AltUnavailable("Senate eFD session expired.");
      }
      const rows = parseSenatePtr(html);
      return rows.length
        ? { parsed: true, reason: null, trades: rows }
        : {
            parsed: false,
            reason: "no transaction rows recognised",
            trades: [],
          };
    },
  });
}
