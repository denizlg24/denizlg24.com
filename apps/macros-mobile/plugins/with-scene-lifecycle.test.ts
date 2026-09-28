import { describe, expect, test } from "bun:test";
import { adoptSceneLifecycle } from "./with-scene-lifecycle.js";

// The launch path of expo-template-bare-minimum@57.0.27's AppDelegate.swift.
const TEMPLATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe("adoptSceneLifecycle", () => {
  const adopted = adoptSceneLifecycle(TEMPLATE);

  test("leaves window creation and React Native startup to the scene delegate", () => {
    expect(adopted).not.toContain("UIWindow(frame:");
    expect(adopted).not.toContain("startReactNative");
    expect(adopted).toContain(
      "reactNativeFactory = factory\n\n    return super.application(",
    );
  });

  test("hands the factory to the scene delegate", () => {
    expect(adopted).toContain(
      "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
    );
    expect(adopted).toContain("class SceneDelegate: ExpoAppSceneDelegate {}");
  });

  test("is idempotent", () => {
    expect(adoptSceneLifecycle(adopted)).toBe(adopted);
  });

  test("refuses a template it does not recognise", () => {
    expect(() =>
      adoptSceneLifecycle(
        TEMPLATE.replace("window = UIWindow", "win = UIWindow"),
      ),
    ).toThrow(/no longer starts React Native/);
  });
});
