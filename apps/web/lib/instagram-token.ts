import { connectDB } from "@/lib/mongodb";
import InstagramToken, { type IInstagramToken } from "@/models/InstagramToken";

export async function getInstagramToken(): Promise<IInstagramToken | null> {
  await connectDB();
  const token = await InstagramToken.findOne().sort({ createdAt: -1 }).lean();
  return token ? { ...token, _id: token._id.toString() } : null;
}
export async function deleteInstagramToken(id: string): Promise<void> {
  await connectDB();
  await InstagramToken.findByIdAndDelete(id);
}
