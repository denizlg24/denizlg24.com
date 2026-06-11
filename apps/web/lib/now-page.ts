import { connectDB } from "@/lib/mongodb";
import NowPage, { type INowPageLean } from "@/models/NowPage";

export async function getNowPageContent(): Promise<INowPageLean | null> {
  await connectDB();

  const doc = await NowPage.findOne().sort({ updatedAt: -1 }).lean().exec();

  if (!doc) return null;

  return {
    ...doc,
    _id: doc._id.toString(),
  } as INowPageLean;
}

export async function upsertNowPageContent(content: string) {
  await connectDB();

  const existing = await NowPage.findOne().exec();

  if (existing) {
    const updated = await NowPage.findByIdAndUpdate(
      existing._id,
      { content },
      { new: true, runValidators: true },
    );
    return updated;
  }

  const doc = await NowPage.create({ content });
  return doc;
}
