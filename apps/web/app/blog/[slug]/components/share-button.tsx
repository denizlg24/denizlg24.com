"use client";

import { Share2 } from "lucide-react";
import { TwitterShareButton } from "next-share";
export const ShareButton = ({ url, title }: { url: string; title: string }) => {
  return (
    <TwitterShareButton url={url} title={title}>
      <Share2 className="w-4 h-4" />
    </TwitterShareButton>
  );
};
