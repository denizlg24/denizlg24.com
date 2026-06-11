import { getAllInstagramPosts } from "@/lib/instagram_posts";
import { InstagramPostsGallery } from "./instagram-posts-gallery";

export default async function InstagramSection() {
  const posts = await getAllInstagramPosts();
  return (
    <InstagramPostsGallery
      items={posts.filter((post) => post.media_type !== "VIDEO")}
    />
  );
}
