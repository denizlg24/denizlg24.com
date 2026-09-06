/**
 * Whether a sandbox backend exists, answered without loading one.
 *
 * This is deliberately its own module with no imports. The registry and the
 * system prompt both need the answer, and reaching it through `sandbox.ts`
 * pulled the sandbox SDK into their import graph — which broke them in any
 * environment where that package does not load, for a question that is one
 * environment variable.
 *
 * The Vercel-hosted backend stopped working when the platform was exited (it
 * authenticated through a token the Vercel runtime injected, and nothing
 * injects it on Forge). `apps/sandbox` is the replacement and is a scaffold
 * today, so this is false in production until it can actually run code. While
 * it is false the sandbox tools are dropped from the registry and the prompt
 * does not advertise the capability: a model told it has a microVM reaches for
 * it on exactly the work nothing else covers, and spends a turn on an
 * unrecoverable configuration error every time.
 *
 * Background: docs/internal/plans/019-ui-ux-fixes-sep5.md, section B10.
 */
export function sandboxEnabled(): boolean {
  return Boolean(process.env.SANDBOX_API_URL);
}
