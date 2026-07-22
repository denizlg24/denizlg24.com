/**
 * PlatformBridge — host-capability seam for things that aren't HTTP data access:
 * opening external links, clipboard, notifications, file downloads. Desktop wires
 * these to Tauri plugins; web wires them to browser APIs. Features that have no
 * web analogue should degrade gracefully rather than throw.
 */
export interface PlatformBridge {
  openExternal(url: string): void | Promise<void>;
  navigate(path: string): void | Promise<void>;
  copyText(text: string): Promise<void>;
  notify(title: string, body?: string): void | Promise<void>;
  downloadFile(
    filename: string,
    data: Blob | string,
    mimeType?: string,
  ): Promise<void>;
  /** Host-specific catalog picker. Desktop reuses the homepage chat picker. */
  HostedModelSelector?: ComponentType<HostedModelSelectorProps>;
  localLlm?: {
    listModels(signal?: AbortSignal): Promise<
      Array<{
        name: string;
        model: string;
        tools?: boolean;
        embedding?: boolean;
      }>
    >;
    generate(options: {
      model: string;
      messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>;
      signal?: AbortSignal;
      tools?: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }>;
    }): Promise<{
      content: string;
      toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
    }>;
  };
}

import type { LlmCatalogModel } from "@repo/schemas";
import type { ComponentType } from "react";

export interface HostedModelSelectorProps {
  model: string | null;
  onModelChange: (model: string) => void;
  models: LlmCatalogModel[] | null;
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  onRetry?: () => void;
  requiredCapabilities?: string[];
  className?: string;
}
