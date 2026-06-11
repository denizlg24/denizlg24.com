import { Contact, type ILeanContact } from "@/models/Contact";
import { connectDB } from "./mongodb";

export async function createContact(data: {
  name: string;
  email: string;
  message: string;
  ipAddress: string;
  userAgent: string;
}): Promise<ILeanContact> {
  await connectDB();

  const contact = new Contact({
    name: data.name,
    email: data.email,
    message: data.message,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    status: "pending",
    emailSent: false,
  });

  await contact.save();

  return contact.toObject() as ILeanContact;
}

export async function getContactByTicketId(
  ticketId: string,
): Promise<ILeanContact | null> {
  await connectDB();

  const contact = await Contact.findOne({ ticketId }).lean();
  return contact as ILeanContact | null;
}

export async function getAllContacts(filters?: {
  status?: "pending" | "read" | "responded" | "archived";
  limit?: number;
  skip?: number;
}): Promise<ILeanContact[]> {
  await connectDB();

  const query = Contact.find(filters?.status ? { status: filters.status } : {})
    .sort({ createdAt: -1 })
    .lean();

  if (filters?.limit) {
    query.limit(filters.limit);
  }

  if (filters?.skip) {
    query.skip(filters.skip);
  }

  const contacts = await query;
  return contacts as ILeanContact[];
}

export async function updateContactStatus(
  ticketId: string,
  status: "pending" | "read" | "responded" | "archived",
): Promise<ILeanContact | null> {
  await connectDB();

  const contact = await Contact.findOneAndUpdate(
    { ticketId },
    { status },
    { new: true },
  ).lean();

  return contact as ILeanContact | null;
}

export async function markEmailSent(ticketId: string): Promise<boolean> {
  await connectDB();

  const result = await Contact.updateOne({ ticketId }, { emailSent: true });

  return result.modifiedCount > 0;
}

export async function getContactCountByStatus(): Promise<{
  pending: number;
  read: number;
  responded: number;
  archived: number;
  total: number;
}> {
  await connectDB();

  const [pending, read, responded, archived, total] = await Promise.all([
    Contact.countDocuments({ status: "pending" }),
    Contact.countDocuments({ status: "read" }),
    Contact.countDocuments({ status: "responded" }),
    Contact.countDocuments({ status: "archived" }),
    Contact.countDocuments(),
  ]);

  return { pending, read, responded, archived, total };
}

export async function deleteContact(ticketId: string): Promise<boolean> {
  await connectDB();

  const result = await Contact.deleteOne({ ticketId });
  return result.deletedCount > 0;
}
