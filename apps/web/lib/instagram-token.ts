import { connectDB } from "@/lib/mongodb";
import InstagramToken, { type IInstagramToken } from "@/models/InstagramToken";

export async function getInstagramToken(): Promise<IInstagramToken | null> {
  await connectDB();
  const token = await InstagramToken.findOne().sort({ createdAt: -1 }).lean();
  return token ? { ...token, _id: token._id.toString() } : null;
}
export async function deleteInstagramToken(): Promise<number> {
  await connectDB();
  const { deletedCount } = await InstagramToken.deleteMany({});
  return deletedCount;
}
