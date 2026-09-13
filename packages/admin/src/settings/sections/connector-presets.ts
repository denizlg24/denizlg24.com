import type { ConnectorAuth } from "@repo/schemas";
import type { IconType } from "react-icons";
import { FaSlack } from "react-icons/fa6";
import {
  SiAtlassian,
  SiCloudflare,
  SiGithub,
  SiLinear,
  SiNotion,
  SiSentry,
  SiStripe,
  SiSupabase,
  SiVercel,
} from "react-icons/si";

export interface ConnectorPreset {
  name: string;
  slug: string;
  url: string;
  auth: Exclude<ConnectorAuth, "service">;
  icon: IconType;
  /** The authorization server has no dynamic client registration. */
  clientRequired?: boolean;
}

/**
 * GitHub supports OAuth but not dynamic registration; a fine-grained token
 * scopes it to chosen repositories, which an OAuth App's `repo` scope cannot.
 */
export const CONNECTOR_PRESETS: ConnectorPreset[] = [
  {
    name: "Atlassian",
    slug: "atlassian",
    url: "https://mcp.atlassian.com/v1/mcp",
    auth: "oauth",
    icon: SiAtlassian,
  },
  {
    name: "Cloudflare Bindings",
    slug: "cloudflare-bindings",
    url: "https://bindings.mcp.cloudflare.com/mcp",
    auth: "oauth",
    icon: SiCloudflare,
  },
  {
    name: "Cloudflare Builds",
    slug: "cloudflare-builds",
    url: "https://builds.mcp.cloudflare.com/mcp",
    auth: "oauth",
    icon: SiCloudflare,
  },
  {
    name: "Cloudflare Docs",
    slug: "cloudflare-docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    auth: "none",
    icon: SiCloudflare,
  },
  {
    name: "Cloudflare Observability",
    slug: "cloudflare-observability",
    url: "https://observability.mcp.cloudflare.com/mcp",
    auth: "oauth",
    icon: SiCloudflare,
  },
  {
    name: "GitHub",
    slug: "github",
    url: "https://api.githubcopilot.com/mcp/",
    auth: "bearer",
    icon: SiGithub,
  },
  {
    name: "GitHub Projects",
    slug: "github-projects",
    url: "https://api.githubcopilot.com/mcp/x/projects",
    auth: "bearer",
    icon: SiGithub,
  },
  {
    name: "Linear",
    slug: "linear",
    url: "https://mcp.linear.app/mcp",
    auth: "oauth",
    icon: SiLinear,
  },
  {
    name: "Notion",
    slug: "notion",
    url: "https://mcp.notion.com/mcp",
    auth: "oauth",
    icon: SiNotion,
  },
  {
    name: "Sentry",
    slug: "sentry",
    url: "https://mcp.sentry.dev/mcp",
    auth: "oauth",
    icon: SiSentry,
  },
  {
    name: "Slack",
    slug: "slack",
    url: "https://mcp.slack.com/mcp",
    auth: "oauth",
    icon: FaSlack,
    clientRequired: true,
  },
  {
    name: "Stripe",
    slug: "stripe",
    url: "https://mcp.stripe.com",
    auth: "oauth",
    icon: SiStripe,
  },
  {
    name: "Supabase",
    slug: "supabase",
    url: "https://mcp.supabase.com/mcp",
    auth: "oauth",
    icon: SiSupabase,
  },
  {
    name: "Vercel",
    slug: "vercel",
    url: "https://mcp.vercel.com",
    auth: "oauth",
    icon: SiVercel,
  },
];

const ICON_BY_HOST = new Map(
  CONNECTOR_PRESETS.map((preset) => [
    new URL(preset.url).hostname,
    preset.icon,
  ]),
);

/** A connector's brand icon, by host, whether or not it came from a preset. */
export function connectorIcon(url: string): IconType | null {
  if (!URL.canParse(url)) return null;
  return ICON_BY_HOST.get(new URL(url).hostname) ?? null;
}
