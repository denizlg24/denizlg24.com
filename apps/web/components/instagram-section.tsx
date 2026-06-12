import { getAllInstagramPosts } from "@/lib/instagram_posts";
import { InstagramPostsGallery } from "./instagram-posts-gallery";

export default async function InstagramSection() {
  let posts: Awaited<ReturnType<typeof getAllInstagramPosts>>;

  try {
    posts = await getAllInstagramPosts();
  } catch {
    return null;
  }

  return (
    <InstagramPostsGallery
      items={posts.filter((post) => post.media_type !== "VIDEO")}
    />
  );
}
