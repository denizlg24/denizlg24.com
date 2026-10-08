export type ActionFailure = { ok: false; error: string };
export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure;
/** Any result, when only success or failure matters to the caller. */
export type ActionOutcome = { ok: true } | ActionFailure;
