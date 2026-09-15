import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { patchAppDelegate } = require("./withIosSceneLifecycle.js") as {
  patchAppDelegate: (contents: string) => string;
};

// Published expo-template-bare-minimum@57.0.1 / Expo sdk-57 AppDelegate.swift.
// The blank line after `reactNativeFactory = factory` is what the old exact
// string replace missed.
const EXPO_SDK_57_APP_DELEGATE = `internal import Expo
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

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;

function compactWindowBlock(template: string): string {
  return template.replace(
    "    reactNativeFactory = factory\n\n#if os(iOS) || os(tvOS)",
    "    reactNativeFactory = factory\n#if os(iOS) || os(tvOS)",
  );
}

function expectMovedWindow(patched: string) {
  expect(patched).toContain("self.launchOptions = launchOptions");
  expect(patched).toContain("var launchOptions: [UIApplication.LaunchOptionsKey: Any]?");
  expect(patched).toContain("class SceneDelegate: UIResponder, UIWindowSceneDelegate");
  expect(patched).toContain("graft-ios-scene-lifecycle");
  expect(patched).not.toContain("window = UIWindow(frame: UIScreen.main.bounds)");
  expect(patched).toContain("let window = UIWindow(windowScene: windowScene)");
  expect(patched).toMatch(
    /reactNativeDelegate = delegate\n\s*reactNativeFactory = factory\n\s*self\.launchOptions = launchOptions/,
  );
}

describe("patchAppDelegate", () => {
  it("moves RN window creation out of the current Expo SDK 57 template", () => {
    expectMovedWindow(patchAppDelegate(EXPO_SDK_57_APP_DELEGATE));
  });

  it("still matches the compact template with no blank line before #if", () => {
    expectMovedWindow(patchAppDelegate(compactWindowBlock(EXPO_SDK_57_APP_DELEGATE)));
  });

  it("tolerates extra blank lines and CRLF around the window block", () => {
    const drifted = EXPO_SDK_57_APP_DELEGATE.replace(
      "    reactNativeFactory = factory\n\n#if os(iOS) || os(tvOS)",
      "    reactNativeFactory = factory\n\n\n#if os(iOS) || os(tvOS)",
    ).replaceAll("\n", "\r\n");

    expectMovedWindow(patchAppDelegate(drifted));
  });

  it("is idempotent once SceneDelegate is present", () => {
    const patched = patchAppDelegate(EXPO_SDK_57_APP_DELEGATE);
    expect(patchAppDelegate(patched)).toBe(patched);
  });

  it("throws when the window-creation block is missing", () => {
    expect(() => patchAppDelegate("class AppDelegate {}\n")).toThrow(
      "Could not move React Native window creation out of AppDelegate",
    );
  });
});
