import { getAllInstagramPosts } from "@/lib/instagram_posts";
import { InstagramGrid } from "./instagram-grid";

export async function InstagramGridServer({ count = 6 }: { count?: number }) {
  const allPosts = await getAllInstagramPosts();

  const posts = allPosts
    .filter((post) => post.media_type !== "VIDEO")
    .slice(0, count);

  return <InstagramGrid posts={posts} />;
}
