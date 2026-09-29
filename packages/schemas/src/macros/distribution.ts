import { z } from "zod";

/**
 * iPhone XS and later report `00008030-001A2B3C4D5E6F70` (8 + 16 hex); older
 * devices a bare 40-hex SHA-1. Finder and the Apple Devices app both show the
 * modern form with its hyphen; one pasted without it gets it back.
 */
export const macrosUdidSchema = z
  .string()
  .overwrite((value) => {
    const compact = value.replace(/\s+/g, "").toUpperCase();
    return /^[0-9A-F]{24}$/.test(compact)
      ? `${compact.slice(0, 8)}-${compact.slice(8)}`
      : compact;
  })
  .regex(
    /^(?:[0-9A-F]{8}-[0-9A-F]{16}|[0-9A-F]{40})$/,
    "That does not look like an iPhone UDID",
  );

export const macrosDistributionRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "declined",
]);

export const macrosCreateDistributionRequestBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  udid: macrosUdidSchema,
  note: z.string().trim().max(1000).optional(),
  /** Honeypot: hidden on the form, so anything in it came from a bot. */
  website: z.string().optional(),
});

/** Never more than the status: the UDID may belong to someone else's request. */
export const macrosDistributionRequestReceiptSchema = z.object({
  status: macrosDistributionRequestStatusSchema,
});

export const macrosDistributionRequestSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  udid: z.string(),
  note: z.string().nullable(),
  status: macrosDistributionRequestStatusSchema,
  appleDeviceId: z.string().nullable(),
  decidedAt: z.string().nullable(),
  registeredAt: z.string().nullable(),
  installableAt: z.string().nullable(),
  notifiedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const macrosDistributionRequestsResponseSchema = z.object({
  requests: z.array(macrosDistributionRequestSchema),
});

export const macrosDistributionAccessResponseSchema = z.object({
  owner: z.boolean(),
});

export const macrosDistributionDecisionBodySchema = z.object({
  action: z.enum(["approve", "decline"]),
});

/**
 * `not-configured` means the approval stands but no build was dispatched;
 * `not-applicable` is a decline.
 */
export const macrosDistributionBuildDispatchSchema = z.enum([
  "triggered",
  "not-configured",
  "failed",
  "not-applicable",
]);

export const macrosDistributionDecisionResponseSchema = z.object({
  request: macrosDistributionRequestSchema,
  build: macrosDistributionBuildDispatchSchema,
});

export const macrosDistributionApprovedDeviceSchema = z.object({
  id: z.uuid(),
  udid: z.string(),
  name: z.string(),
});

export const macrosDistributionApprovedResponseSchema = z.object({
  devices: z.array(macrosDistributionApprovedDeviceSchema),
});

export const macrosDistributionRegistrationSchema = z.union([
  z.object({ id: z.uuid(), appleDeviceId: z.string().min(1) }),
  z.object({ id: z.uuid(), error: z.string().min(1).max(2000) }),
]);

export const macrosDistributionRegisteredBodySchema = z.object({
  items: z.array(macrosDistributionRegistrationSchema).max(500),
});

export const macrosDistributionRegisteredResponseSchema = z.object({
  updated: z.number().int(),
});

export const macrosDistributionPublishedBodySchema = z.object({
  version: z.string().trim().min(1).max(40),
  udids: z.array(macrosUdidSchema).max(500),
});

export const macrosDistributionPublishedResponseSchema = z.object({
  installable: z.number().int(),
  notified: z.number().int(),
  failed: z.number().int(),
});

export type MacrosUdid = z.infer<typeof macrosUdidSchema>;
export type MacrosDistributionRequestStatus = z.infer<
  typeof macrosDistributionRequestStatusSchema
>;
export type MacrosCreateDistributionRequestBody = z.input<
  typeof macrosCreateDistributionRequestBodySchema
>;
export type MacrosDistributionRequestReceipt = z.infer<
  typeof macrosDistributionRequestReceiptSchema
>;
export type MacrosDistributionRequest = z.infer<
  typeof macrosDistributionRequestSchema
>;
export type MacrosDistributionRequestsResponse = z.infer<
  typeof macrosDistributionRequestsResponseSchema
>;
export type MacrosDistributionAccessResponse = z.infer<
  typeof macrosDistributionAccessResponseSchema
>;
export type MacrosDistributionDecisionBody = z.infer<
  typeof macrosDistributionDecisionBodySchema
>;
export type MacrosDistributionBuildDispatch = z.infer<
  typeof macrosDistributionBuildDispatchSchema
>;
export type MacrosDistributionDecisionResponse = z.infer<
  typeof macrosDistributionDecisionResponseSchema
>;
export type MacrosDistributionApprovedDevice = z.infer<
  typeof macrosDistributionApprovedDeviceSchema
>;
export type MacrosDistributionApprovedResponse = z.infer<
  typeof macrosDistributionApprovedResponseSchema
>;
export type MacrosDistributionRegistration = z.infer<
  typeof macrosDistributionRegistrationSchema
>;
export type MacrosDistributionRegisteredBody = z.infer<
  typeof macrosDistributionRegisteredBodySchema
>;
export type MacrosDistributionRegisteredResponse = z.infer<
  typeof macrosDistributionRegisteredResponseSchema
>;
export type MacrosDistributionPublishedBody = z.infer<
  typeof macrosDistributionPublishedBodySchema
>;
export type MacrosDistributionPublishedResponse = z.infer<
  typeof macrosDistributionPublishedResponseSchema
>;
