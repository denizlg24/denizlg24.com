import { Blog } from "@/models/Blog";
import { BlogView } from "@/models/BlogView";
import { connectDB } from "./mongodb";

export async function getBlogTags() {
  await connectDB();
  const tags = await Blog.distinct("tags");
  return tags;
}

export async function getFilteredActiveBlogs({
  tags,
  query,
}: {
  tags: string[];
  query: string;
}) {
  await connectDB();
  const filter: any = { isActive: true };

  if (tags.length > 0) {
    filter.tags = { $all: tags };
  }

  if (query) {
    filter.$or = [
      { title: { $regex: query, $options: "i" } },
      { subtitle: { $regex: query, $options: "i" } },
      { description: { $regex: query, $options: "i" } },
      { tags: { $regex: query, $options: "i" } },
    ];
  }

  const blogs = await Blog.find(filter).sort({ order: 1 }).lean();
  return blogs.map((blog) => ({
    ...blog,
    _id: blog._id.toString(),
  }));
}

export async function getAllBlogs() {
  await connectDB();
  const blogs = await Blog.find().sort({ order: 1 }).lean();
  return blogs.map((blog) => ({
    ...blog,
    _id: blog._id.toString(),
  }));
}

export async function getActiveBlogs() {
  await connectDB();
  const blogs = await Blog.find({ isActive: true }).sort({ order: 1 }).lean();
  return blogs.map((blog) => ({
    ...blog,
    _id: blog._id.toString(),
  }));
}

export async function getBlogById(id: string) {
  await connectDB();
  const blog = await Blog.findById(id).lean();
  if (!blog) return null;

  return {
    ...blog,
    _id: blog._id.toString(),
  };
}

export async function getBlogBySlug(slug: string) {
  await connectDB();
  const blog = await Blog.findOne({ slug }).lean();
  if (!blog) return null;
  return {
    ...blog,
    _id: blog._id.toString(),
  };
}

export async function toggleBlogActive(id: string) {
  await connectDB();
  const blog = await Blog.findById(id);
  if (!blog) return null;

  blog.isActive = !blog.isActive;
  await blog.save();

  return {
    ...blog.toObject(),
    _id: blog._id.toString(),
  };
}

export async function getAllBlogViews() {
  await connectDB();
  const views = await BlogView.find().lean();
  return views.reduce(
    (acc, view) => {
      acc[view.blogId] = view.views;
      return acc;
    },
    {} as Record<string, number>,
  );
}

export async function getBlogViewCount(blogId: string) {
  await connectDB();
  const view = await BlogView.findOne({ blogId }).lean();
  return view?.views || 0;
}

export async function incrementBlogViewCount(blogId: string) {
  await connectDB();
  const view = await BlogView.findOneAndUpdate(
    { blogId },
    { $inc: { views: 1 } },
    { upsert: true, new: true },
  );
  return view.views;
}
