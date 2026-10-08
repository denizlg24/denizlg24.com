// CommonJS on purpose: Expo requires config plugins as plain JavaScript.
// A copy of apps/macros-mobile/plugins/with-scene-lifecycle.js for the apps
// built on this package; both go once the Expo template adopts scenes.
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

// Apps linked against the iOS 27 SDK refuse to launch without the UIScene life
// cycle. Expo 57 ships `ExpoAppSceneDelegate`, which creates the window and
// starts React Native, but its prebuild template still starts React Native
// from the app delegate. Remove when the template adopts scenes itself.

const SCENE_DELEGATE_CLASS = "SceneDelegate";

const APP_DELEGATE_DECLARATION = "class AppDelegate: ExpoAppDelegate {";
const SCENE_APP_DELEGATE_DECLARATION =
  "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {";

const WINDOW_STARTUP =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

// Declared in AppDelegate.swift so the class links into the app target without
// adding a file to the Xcode project.
const SCENE_DELEGATE_DECLARATION = `
class ${SCENE_DELEGATE_CLASS}: ExpoAppSceneDelegate {}
`;

/**
 * @param {string} appDelegate
 * @returns {string}
 */
function adoptSceneLifecycle(appDelegate) {
  if (appDelegate.includes(SCENE_APP_DELEGATE_DECLARATION)) {
    return appDelegate;
  }
  if (!appDelegate.includes(APP_DELEGATE_DECLARATION)) {
    throw new Error(
      "expo-ios-targets withSceneLifecycle: AppDelegate.swift no longer declares `class AppDelegate: ExpoAppDelegate`; check whether the Expo template adopted scenes and drop the plugin.",
    );
  }
  if (!WINDOW_STARTUP.test(appDelegate)) {
    throw new Error(
      "expo-ios-targets withSceneLifecycle: AppDelegate.swift no longer starts React Native into its own window; check whether the Expo template adopted scenes and drop the plugin.",
    );
  }
  return (
    appDelegate
      .replace(APP_DELEGATE_DECLARATION, SCENE_APP_DELEGATE_DECLARATION)
      .replace(WINDOW_STARTUP, "") + SCENE_DELEGATE_DECLARATION
  );
}

/** @type {import("expo/config-plugins").ConfigPlugin} */
const withSceneLifecycle = (config) => {
  const withDelegate = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error(
        "expo-ios-targets withSceneLifecycle: expected a Swift AppDelegate from the Expo template.",
      );
    }
    mod.modResults.contents = adoptSceneLifecycle(mod.modResults.contents);
    return mod;
  });

  return withInfoPlist(withDelegate, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: `$(PRODUCT_MODULE_NAME).${SCENE_DELEGATE_CLASS}`,
          },
        ],
      },
    };
    return mod;
  });
};

module.exports = withSceneLifecycle;
module.exports.adoptSceneLifecycle = adoptSceneLifecycle;
