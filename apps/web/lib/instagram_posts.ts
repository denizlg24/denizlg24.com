import { getInstagramToken } from "./instagram-token";

export interface InstagramPost {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url: string;
  permalink: string;
  thumbnail_url?: string;
  timestamp: string;
  username?: string;
}

interface InstagramApiResponse {
  data: InstagramPost[];
  paging?: {
    cursors: {
      before: string;
      after: string;
    };
    next?: string;
  };
  error?: {
    message: string;
    type: string;
    code: number;
  };
}

export async function getAllInstagramPosts(): Promise<InstagramPost[]> {
  const fields =
    "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username";
  const token =
    (await getInstagramToken())?.accessToken ||
    process.env.INSTAGRAM_ACCESS_TOKEN;
  let url: string | null =
    `https://graph.instagram.com/me/media?fields=${fields}&access_token=${token}`;

  const allPosts: InstagramPost[] = [];

  try {
    while (url) {
      const response = await fetch(url);
      const data: InstagramApiResponse = await response.json();

      if (data.error) {
        throw new Error(`Instagram API Error: ${data.error.message}`);
      }

      if (data.data && data.data.length > 0) {
        allPosts.push(...data.data);
      }

      if (data.paging?.next) {
        url = data.paging.next;
      } else {
        url = null;
      }
    }

    return allPosts;
  } catch (error) {
    console.error("Failed to fetch Instagram posts:", error);
    throw error;
  }
}
