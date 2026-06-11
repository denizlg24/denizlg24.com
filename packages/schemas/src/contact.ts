import { z } from "zod";

export const contactSchema = z.object({
  _id: z.string(),
  ticketId: z.string(),
  name: z.string(),
  email: z.string(),
  message: z.string(),
  ipAddress: z.string(),
  userAgent: z.string(),
  status: z.enum(["pending", "read", "responded", "archived"]),
  emailSent: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IContact = z.infer<typeof contactSchema>;

export const contactInputSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});
export type ContactInput = z.infer<typeof contactInputSchema>;
