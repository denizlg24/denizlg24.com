import type { ConfigPlugin } from "expo/config-plugins";

export interface ExtensionTargetOptions {
  /** Xcode target name; must not equal any pod's module name. */
  name: string;
  /** Appended to the app's bundle id: `<app>.<bundleSuffix>`. */
  bundleSuffix: string;
  displayName: string;
  /** Directories, relative to the project root, whose `.swift` files are compiled in. */
  sources: string[];
  deploymentTarget: string;
  entitlements?: Record<string, unknown>;
  infoPlist?: Record<string, unknown>;
  swiftConditions?: string[];
}

export const withExtensionTarget: ConfigPlugin<ExtensionTargetOptions>;
export const withAppSources: ConfigPlugin<{ group: string; sources: string[] }>;
export const withAppCapabilities: ConfigPlugin<{
  entitlements?: Record<string, unknown>;
  infoPlist?: Record<string, unknown>;
}>;
export const withoutScriptSandboxing: ConfigPlugin;
export function plist(entries: Record<string, unknown>): string;
export function swiftSources(
  projectRoot: string,
  dirs: string[],
): { name: string; source: string }[];
/** iOS 27 refuses to launch an app without the UIScene life cycle. */
export const withSceneLifecycle: ConfigPlugin;
