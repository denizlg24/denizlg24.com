import { connectDB } from "@/lib/mongodb";
import TimelineItem, {
  type ITimelineItem,
  type ITimelineItemLean,
} from "@/models/TimelineItem";

export async function getTimelineItems(
  category?: "work" | "education" | "personal",
): Promise<ITimelineItem[]> {
  await connectDB();

  const items = await TimelineItem.find({
    isActive: true,
    ...(category ? { category } : {}),
  })
    .sort({ order: 1, createdAt: -1 })
    .lean()
    .exec();

  return items as ITimelineItem[];
}

export async function getAllTimelineItems(
  category?: "work" | "education" | "personal",
) {
  await connectDB();

  const items = await TimelineItem.find({ ...(category ? { category } : {}) })
    .sort({ order: 1, createdAt: -1 })
    .lean()
    .exec();

  return items;
}

export async function getTimelineItemsByCategory() {
  await connectDB();

  const items = await TimelineItem.find({ isActive: true })
    .sort({ order: 1, createdAt: -1 })
    .lean()
    .exec();

  const grouped = {
    work: [] as ITimelineItem[],
    education: [] as ITimelineItem[],
    personal: [] as ITimelineItem[],
  };

  items.forEach((item: any) => {
    const category = item.category as "work" | "education" | "personal";
    grouped[category].push(item as ITimelineItem);
  });

  return grouped;
}

export async function createTimelineItem(
  data: Omit<ITimelineItemLean, "_id" | "createdAt" | "updatedAt">,
) {
  await connectDB();
  const item = await TimelineItem.create(data);
  return item;
}

export async function updateTimelineItem(
  id: string,
  data: Partial<ITimelineItemLean>,
) {
  await connectDB();
  const item = await TimelineItem.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  });
  return item;
}

export async function deleteTimelineItem(id: string) {
  await connectDB();
  await TimelineItem.findByIdAndDelete(id);
}

export async function getTimelineItemById(id: string) {
  await connectDB();
  const item = await TimelineItem.findById(id).lean().exec();
  if (!item) return null;

  return {
    ...item,
    _id: item._id.toString(),
  };
}

export async function toggleTimelineItemActive(id: string) {
  await connectDB();
  const item = await TimelineItem.findById(id);
  if (!item) throw new Error("Timeline item not found");

  const updatedItem = await TimelineItem.findByIdAndUpdate(
    id,
    { isActive: !item.isActive },
    { new: true, runValidators: true },
  );

  return updatedItem;
}
