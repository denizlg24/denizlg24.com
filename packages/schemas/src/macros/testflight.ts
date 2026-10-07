import { z } from "zod";

/**
 * `POST /api/testflight` adds the address to the public TestFlight group.
 * `website` is a honeypot: people never see it, so anything in it is a bot.
 */
export const macrosTestFlightSignupBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  website: z.string().max(200).optional(),
});

export type MacrosTestFlightSignupBody = z.infer<
  typeof macrosTestFlightSignupBodySchema
>;

export const macrosTestFlightSignupResponseSchema = z.object({
  status: z.enum(["invited", "already-invited"]),
});

export type MacrosTestFlightSignupResponse = z.infer<
  typeof macrosTestFlightSignupResponseSchema
>;
