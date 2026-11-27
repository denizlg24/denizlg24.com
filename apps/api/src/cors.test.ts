import { expect, it } from "bun:test";
import { apiCorsHeaders } from "./app";
import { TURNSTILE_HEADER } from "./auth/turnstile";

it("lets the auth app send its Turnstile token across origins", () => {
  expect(apiCorsHeaders.map((header) => header.toLowerCase())).toContain(
    TURNSTILE_HEADER,
  );
});
