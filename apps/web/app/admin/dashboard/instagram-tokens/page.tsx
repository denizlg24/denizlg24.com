import { Badge } from "@repo/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/empty";
import { Clock, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { FaInstagram } from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { getInstagramToken } from "@/lib/instagram-token";
import { getAdminSession } from "@/lib/require-admin";

const generateInstagramAuthUrl = () => {
  const appId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

  const scope = [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
  ].join(",");

  const url = `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  return url;
};

export default async function TimelinePage() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }
  const token = await getInstagramToken();

  if (!token) {
    return (
      <div className="w-full flex flex-col gap-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Instagram Tokens</h1>
        <div>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FaInstagram className="w-12 h-12 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>No Tokens Yet</EmptyTitle>
              <EmptyDescription>
                You don't have any long term tokens yet. Connect your Instagram
                to generate one.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex gap-2">
                <Button asChild>
                  <Link href={generateInstagramAuthUrl()}>Link Instagram</Link>
                </Button>
              </div>
            </EmptyContent>
          </Empty>
        </div>
      </div>
    );
  }

  const now = new Date();
  const expiresAt = new Date(token.expiresAt);
  const daysUntilExpiry = Math.floor(
    (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  const isExpired = daysUntilExpiry < 0;
  const isExpiringSoon = daysUntilExpiry <= 7 && daysUntilExpiry >= 0;

  return (
    <div className="w-full flex flex-col gap-6">
      <h1 className="text-2xl sm:text-3xl font-bold">Instagram Tokens</h1>

      <div className="flex items-center gap-4 p-4 border rounded-lg bg-card">
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm text-muted-foreground mb-1">
            Token ID
          </p>
          <code className="text-xs sm:text-sm font-mono truncate block">
            {token._id.toString()}
          </code>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          {isExpired ? (
            <Badge variant="destructive">Expired</Badge>
          ) : isExpiringSoon ? (
            <Badge
              variant="outline"
              className="border-yellow-500 text-yellow-600 dark:text-yellow-500"
            >
              Expires in {daysUntilExpiry}d
            </Badge>
          ) : (
            <Badge variant="secondary">Expires in {daysUntilExpiry}d</Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            asChild
            title="Regenerate Token"
          >
            <Link href={generateInstagramAuthUrl()}>
              <RefreshCw className="w-4 h-4" />
            </Link>
          </Button>
          <form
            action={async () => {
              "use server";
              const { deleteInstagramToken } = await import(
                "@/lib/instagram-token"
              );
              await deleteInstagramToken(token._id.toString());
              const { redirect } = await import("next/navigation");
              redirect("/admin/dashboard/instagram-tokens");
            }}
          >
            <Button
              variant="outline"
              size="icon"
              type="submit"
              title="Delete Token"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
