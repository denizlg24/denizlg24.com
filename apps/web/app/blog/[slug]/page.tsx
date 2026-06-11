export const revalidate = 2592000; // Revalidate every 30 days

import { ArrowLeft, Calendar, Clock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getActiveBlogs, getBlogBySlug } from "@/lib/blog";
import { BlogViewCounter } from "./components/blog-view-counter";
import { CommentsSection } from "./components/comments-section";
import { ShareButton } from "./components/share-button";
export async function generateStaticParams() {
  const blogs = await getActiveBlogs();

  return blogs.map((blog) => ({
    slug: blog.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const blog = await getBlogBySlug(slug);
  if (!blog) {
    return {
      title: "Blog Post Not Found",
      description: "The requested blog post does not exist.",
    };
  }
  return {
    title: {
      absolute: `${blog.title} | Deniz Lopes Güneş`,
    },
    description: blog.excerpt,
    openGraph: {
      title: `${blog.title} | Deniz Lopes Güneş`,
      description: blog.excerpt,
      url: `https://denizlg24.com/blog/${blog.slug}`,
      type: "article",
      locale: "en_US",
      siteName: "Deniz Lopes Güneş Portfolio",
    },
    twitter: {
      card: "summary_large_image",
      title: `${blog.title} | Deniz Lopes Güneş`,
      description: blog.excerpt,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const blog = await getBlogBySlug(slug);
  if (!blog) {
    notFound();
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <main className="flex flex-col items-center justify-center">
      <article className="w-full max-w-3xl mx-auto px-4 items-center mt-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to blog
        </Link>

        <header className="mb-8">
          <h1 className="sm:text-4xl xs:text-3xl text-2xl font-calistoga text-balance">
            {blog.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground mt-4">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {formatDate(blog.createdAt)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {blog.timeToRead} min read
            </span>
            <BlogViewCounter blogId={blog._id} />
            <ShareButton
              url={`https://denizlg24.com/blog/${blog.slug}`}
              title={`I've just read "${blog.title}" on Deniz Lopes Güneş's blog and I think you should check it out too!\n\nCheck it out here: `}
            />
          </div>

          {blog.tags && blog.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-4">
              {blog.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <p className="text-muted-foreground mt-4 text-lg leading-relaxed">
            {blog.excerpt}
          </p>
        </header>

        <Separator className="my-6" />

        <div className="prose-container">
          <MarkdownRenderer content={blog.content} />
        </div>

        <Separator className="my-8" />

        <section className="mb-12">
          <CommentsSection blogId={blog._id} />
        </section>
      </article>
    </main>
  );
}
