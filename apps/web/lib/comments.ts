import { Blog } from "@/models/Blog";
import { BlogComment, type ILeanBlogComment } from "@/models/BlogComment";
import { connectDB } from "./mongodb";

export async function sendToSlack({
  comment,
  blogTitle,
  blogSlug,
}: {
  comment: ILeanBlogComment;
  blogTitle?: string;
  blogSlug?: string;
}) {
  const webhookUrl = process.env.SLACK_COMMENTS_WEBHOOK_URL;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://denizlg24.com";

  if (!webhookUrl) {
    return { success: false, message: "Slack webhook URL is not configured" };
  }

  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const isReply = !!comment.commentId;
  const headerText = isReply
    ? "New Reply on Blog Post"
    : "New Comment on Blog Post";

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: headerText,
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Posted:* ${timestamp}${
            blogTitle ? ` | *On:* ${blogTitle}` : ""
          }`,
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Author*\n${comment.authorName}`,
        },
        {
          type: "mrkdwn",
          text: `*Type*\n${isReply ? "Reply" : "Top-level comment"}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Comment*\n>${comment.content.split("\n").join("\n>")}`,
      },
    },
    {
      type: "divider",
    },
    {
      type: "actions",
      elements: [
        ...(blogSlug
          ? [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View Blog Post",
                  emoji: true,
                },
                url: `${siteUrl}/blog/${blogSlug}`,
              },
            ]
          : []),
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Moderate in Admin",
            emoji: true,
          },
          url: `${siteUrl}/admin/dashboard/comments`,
          style: "primary" as const,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_This comment requires approval before it appears on the site._`,
        },
      ],
    },
  ];

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `New ${isReply ? "reply" : "comment"} from ${comment.authorName}${
        blogTitle ? ` on "${blogTitle}"` : ""
      }`,
      blocks,
    }),
  });

  if (!response.ok) {
    return { success: false, message: "Failed to send message to Slack" };
  }

  return { success: true };
}

export interface CommentWithBlogTitle extends ILeanBlogComment {
  blogTitle?: string;
  blogSlug?: string;
}

export async function getAllComments(options?: {
  limit?: number;
  includeDeleted?: boolean;
}): Promise<CommentWithBlogTitle[]> {
  await connectDB();

  const query: Record<string, unknown> = {};

  if (!options?.includeDeleted) {
    query.isDeleted = { $ne: true };
  }

  const comments = await BlogComment.find(query)
    .sort({ createdAt: -1 })
    .limit(options?.limit || 100)
    .lean();

  const blogIds = [...new Set(comments.map((c) => c.blogId))];

  const blogs = await Blog.find({ _id: { $in: blogIds } })
    .select("_id title slug")
    .lean();

  const blogMap = new Map(
    blogs.map((b) => [b._id.toString(), { title: b.title, slug: b.slug }]),
  );

  return comments.map((comment) => ({
    ...comment,
    _id: comment._id.toString(),
    blogTitle: blogMap.get(comment.blogId)?.title,
    blogSlug: blogMap.get(comment.blogId)?.slug,
  }));
}

export async function getCommentStats() {
  await connectDB();

  const [total, pending, approved, deleted] = await Promise.all([
    BlogComment.countDocuments({ isDeleted: { $ne: true } }),
    BlogComment.countDocuments({ isApproved: false, isDeleted: { $ne: true } }),
    BlogComment.countDocuments({ isApproved: true, isDeleted: { $ne: true } }),
    BlogComment.countDocuments({ isDeleted: true }),
  ]);

  return {
    total,
    pending,
    approved,
    deleted,
  };
}

export async function approveComment(id: string) {
  await connectDB();
  const comment = await BlogComment.findByIdAndUpdate(
    id,
    { isApproved: true },
    { new: true },
  ).lean();

  if (!comment) return null;

  return {
    ...comment,
    _id: comment._id.toString(),
  };
}

export async function rejectComment(id: string) {
  await connectDB();
  const comment = await BlogComment.findByIdAndUpdate(
    id,
    { isApproved: false },
    { new: true },
  ).lean();

  if (!comment) return null;

  return {
    ...comment,
    _id: comment._id.toString(),
  };
}

export async function deleteComment(id: string) {
  await connectDB();

  const comment = await BlogComment.findById(id);
  if (!comment) return null;

  const hasReplies = await BlogComment.exists({ commentId: id });

  if (hasReplies) {
    await BlogComment.findByIdAndUpdate(id, {
      isDeleted: true,
      content: "[deleted]",
      authorName: "[deleted]",
    });
    return { softDeleted: true };
  }

  await BlogComment.findByIdAndDelete(id);
  return { softDeleted: false };
}
