import type { PlatformBridge } from "@repo/admin/platform";
import { ModelSelector } from "@/components/ui/model-selector";
import { isTauri } from "./platform";
import { saveFile } from "./platform-fs";

/** Desktop PlatformBridge: Tauri plugins inside the app, browser APIs in dev. */
export const desktopPlatform: PlatformBridge = {
  HostedModelSelector: ModelSelector,
  async openExternal(url) {
    if (isTauri()) {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },

  navigate(path) {
    window.location.assign(`/dashboard${path}`);
  },

  async copyText(text) {
    if (isTauri()) {
      const { writeText } = await import(
        "@tauri-apps/plugin-clipboard-manager"
      );
      await writeText(text);
      return;
    }
    await navigator.clipboard.writeText(text);
  },

  async notify(title, body) {
    if (isTauri()) {
      const { isPermissionGranted, requestPermission, sendNotification } =
        await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
      return;
    }
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, body ? { body } : undefined);
    }
  },

  async downloadFile(filename, data, mimeType) {
    const bytes =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : new Uint8Array(await data.arrayBuffer());
    await saveFile(filename, bytes, { mimeType });
  },

  localLlm: {
    async listModels(signal) {
      const { OllamaClient } = await import("./ollama");
      const ollama = new OllamaClient();
      const models = await ollama.listModels(signal);
      return Promise.all(
        models.map(async (model) => {
          try {
            const capabilities = await ollama.probeModel(model.model, signal);
            return {
              name: model.name,
              model: model.model,
              tools: capabilities.tools,
              embedding: capabilities.embedding,
            };
          } catch {
            return { name: model.name, model: model.model };
          }
        }),
      );
    },

    async generate({ model, messages, tools, signal }) {
      const { OllamaClient } = await import("./ollama");
      let content = "";
      const toolCalls: Array<{
        name: string;
        input: Record<string, unknown>;
      }> = [];
      for await (const event of new OllamaClient().chat({
        model,
        messages,
        tools,
        signal,
      })) {
        if (event.type === "text_delta") content += event.text;
        if (event.type === "tool_call") {
          toolCalls.push({ name: event.call.name, input: event.call.input });
        }
      }
      if (!content.trim() && toolCalls.length === 0) {
        throw new Error("Ollama returned an empty response");
      }
      return { content, toolCalls };
    },
  },
};
