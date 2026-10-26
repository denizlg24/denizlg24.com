import { describe, expect, test } from "bun:test";
import type { AndroidManifest } from "expo/config-plugins";
import { addTelevision, withoutFocusHighlight } from "./with-android-tv.js";

function template(): AndroidManifest {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      application: [
        {
          $: { "android:name": ".MainApplication" },
          activity: [
            {
              $: { "android:name": ".MainActivity" },
              "intent-filter": [
                {
                  action: [
                    { $: { "android:name": "android.intent.action.MAIN" } },
                  ],
                  category: [
                    {
                      $: { "android:name": "android.intent.category.LAUNCHER" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe("with-android-tv", () => {
  test("lists the app on the TV launcher and keeps it installable on phones", () => {
    const manifest = addTelevision(template());
    const root = manifest.manifest;
    expect(root["uses-feature"]).toEqual([
      {
        $: {
          "android:name": "android.software.leanback",
          "android:required": "false",
        },
      },
      {
        $: {
          "android:name": "android.hardware.touchscreen",
          "android:required": "false",
        },
      },
    ]);
    const application = root.application?.[0];
    expect(application?.$["android:banner"]).toBe("@drawable/tv_banner");
    const categories = application?.activity?.[0]?.[
      "intent-filter"
    ]?.[0]?.category?.map((category) => category.$["android:name"]);
    expect(categories).toEqual([
      "android.intent.category.LAUNCHER",
      "android.intent.category.LEANBACK_LAUNCHER",
    ]);
  });

  test("running twice adds nothing twice", () => {
    const manifest = addTelevision(addTelevision(template()));
    expect(manifest.manifest["uses-feature"]).toHaveLength(2);
    expect(
      manifest.manifest.application?.[0]?.activity?.[0]?.["intent-filter"]?.[0]
        ?.category,
    ).toHaveLength(2);
  });

  test("turns off the system's grey focus box on the app theme", () => {
    const styles = withoutFocusHighlight({
      resources: {
        style: [
          { $: { name: "AppTheme", parent: "Theme.AppCompat" }, item: [] },
        ],
      },
    });
    const items = styles.resources.style?.find(
      (style) => style.$.name === "AppTheme",
    )?.item;
    expect(items).toContainEqual({
      $: { name: "android:defaultFocusHighlightEnabled" },
      _: "false",
    });
  });
});
