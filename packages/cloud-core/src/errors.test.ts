import { describe, expect, it } from "bun:test";

import {
  AuthenticationError,
  CloudCoreError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";

describe("cloud core errors", () => {
  it.each([
    [new AuthenticationError("invalid", "INVALID"), 401, "INVALID"],
    [new NotFoundError("missing", "MISSING"), 404, "MISSING"],
    [new ConflictError("exists", "EXISTS"), 409, "EXISTS"],
    [new ValidationError("invalid", "INVALID"), 400, "INVALID"],
    [new ForbiddenError("denied"), 403, "FORBIDDEN"],
  ])("maps %s to its stable status and code", (error, status, code) => {
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CloudCoreError);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
  });
});
