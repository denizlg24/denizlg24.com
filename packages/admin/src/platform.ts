/**
 * PlatformBridge — host-capability seam for things that aren't HTTP data access:
 * opening external links, clipboard, notifications, file downloads. Desktop wires
 * these to Tauri plugins; web wires them to browser APIs. Features that have no
 * web analogue should degrade gracefully rather than throw.
 */
export interface PlatformBridge {
  openExternal(url: string): void | Promise<void>;
  copyText(text: string): Promise<void>;
  notify(title: string, body?: string): void | Promise<void>;
  downloadFile(
    filename: string,
    data: Blob | string,
    mimeType?: string,
  ): Promise<void>;
}
