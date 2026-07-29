import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { isAuthorizedJobRequest } from "./job-authorization";

describe("isAuthorizedJobRequest", () => {
  const originalWorkerToken = process.env.AGENT_MEMORY_JOB_BEARER_TOKEN;
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.AGENT_MEMORY_JOB_BEARER_TOKEN = "worker-secret";
    process.env.CRON_SECRET = "cron-secret";
  });

  afterAll(() => {
    process.env.AGENT_MEMORY_JOB_BEARER_TOKEN = originalWorkerToken;
    process.env.CRON_SECRET = originalCronSecret;
  });

  test("accepts the worker bearer token", () => {
    expect(
      isAuthorizedJobRequest(
        new Request("http://localhost/jobs", {
          headers: { authorization: "Bearer worker-secret" },
        }),
      ),
    ).toBe(true);
  });

  test("accepts Vercel's cron bearer secret", () => {
    expect(
      isAuthorizedJobRequest(
        new Request("http://localhost/jobs", {
          headers: { authorization: "Bearer cron-secret" },
        }),
      ),
    ).toBe(true);
  });

  test("rejects missing, malformed, and incorrect tokens", () => {
    expect(isAuthorizedJobRequest(new Request("http://localhost/jobs"))).toBe(
      false,
    );
    expect(
      isAuthorizedJobRequest(
        new Request("http://localhost/jobs", {
          headers: { authorization: "cron-secret" },
        }),
      ),
    ).toBe(false);
    expect(
      isAuthorizedJobRequest(
        new Request("http://localhost/jobs", {
          headers: { authorization: "Bearer wrong-secret" },
        }),
      ),
    ).toBe(false);
  });
});
