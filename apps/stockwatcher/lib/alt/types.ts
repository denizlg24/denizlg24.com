/** What every alternative-data read returns: the payload plus where and when it came from. */
export type AltResult<T> = {
  data: T;
  source: string;
  /** When the publisher last changed the underlying data, if it says. */
  asOf: string | null;
  fetchedAt: number;
  /** The last refresh failed; this is the previous good copy. */
  stale: boolean;
};

export class AltUnavailable extends Error {
  constructor(
    message: string,
    readonly status = 502,
    /** False for answers that will not change on retry (a 404, a bad id). */
    readonly transient = true,
  ) {
    super(message);
  }
}

export class AltBadRequest extends AltUnavailable {
  constructor(message: string) {
    super(message, 400, false);
  }
}
