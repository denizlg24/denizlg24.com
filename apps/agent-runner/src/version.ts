declare const AGENT_RUNNER_BUILD_VERSION: string | undefined;

/** Set at compile time with `--define AGENT_RUNNER_BUILD_VERSION='"<sha>"'`. */
export const RUNNER_VERSION: string =
  typeof AGENT_RUNNER_BUILD_VERSION === "string"
    ? AGENT_RUNNER_BUILD_VERSION
    : "dev";
