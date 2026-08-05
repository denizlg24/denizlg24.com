import type { SmbProvisioningAgent } from "@repo/cloud-core";

const PRINCIPAL = /^dc-[a-z0-9-]+-[0-9a-f]{8}$/;
const ACCOUNT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class SmbAgentError extends Error {}

/**
 * Runs the host's SMB credential script.
 *
 * Both arguments are validated here as well as in the script. This process is
 * root and the values arrive over a socket, so treating the script's own
 * checks as the only guard would make a bug in this file a root-level command
 * injection. The secret goes through the environment rather than argv, where
 * it would be visible in /proc to every user on the host.
 */
export function createSmbAgent(scriptPath: string): SmbProvisioningAgent {
  const run = async (
    args: readonly string[],
    env: Record<string, string> = {},
  ): Promise<void> => {
    const child = Bun.spawn(["bash", scriptPath, ...args], {
      env: { ...process.env, ...env },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, code] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) {
      // The script never echoes the secret, but trim anyway rather than
      // forwarding an unbounded blob into an API response.
      throw new SmbAgentError(
        `SMB script failed (${code}): ${stderr.trim().slice(0, 300)}`,
      );
    }
  };

  return {
    async provision(input) {
      if (!PRINCIPAL.test(input.principal)) {
        throw new SmbAgentError("Refusing a principal that is not derived");
      }
      if (!ACCOUNT_ID.test(input.accountId)) {
        throw new SmbAgentError("Refusing a malformed account id");
      }
      if (input.secret.length < 24) {
        throw new SmbAgentError("Refusing a short SMB secret");
      }
      await run(
        [
          "--execute",
          "provision",
          "--principal",
          input.principal,
          "--account-id",
          input.accountId,
        ],
        { POSIX_SMB_SECRET: input.secret },
      );
    },
    async revoke(principal) {
      if (!PRINCIPAL.test(principal)) {
        throw new SmbAgentError("Refusing a principal that is not derived");
      }
      await run(["--execute", "revoke", "--principal", principal]);
    },
  };
}
