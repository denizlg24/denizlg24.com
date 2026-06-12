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
    is_transient?: boolean;
  };
}

const MAX_TRANSIENT_RETRIES = 2;

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

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
      let response: Response;
      let data: InstagramApiResponse;

      for (let attempt = 0; ; attempt++) {
        response = await fetch(url);
        data = (await response.json()) as InstagramApiResponse;

        if (!data.error?.is_transient || attempt >= MAX_TRANSIENT_RETRIES) {
          break;
        }

        await wait(500 * 2 ** attempt);
      }

      if (data.error) {
        throw new Error(
          `Instagram API Error (${response.status}, ${data.error.type}, code ${data.error.code}): ${data.error.message}`,
        );
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
