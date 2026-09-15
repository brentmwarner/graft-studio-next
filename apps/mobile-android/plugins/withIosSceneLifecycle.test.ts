import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { patchAppDelegate } = require("./withIosSceneLifecycle.js") as {
  patchAppDelegate: (contents: string) => string;
};

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
}
`;

function expectMovedWindow(patched: string) {
  expect(patched).toContain("self.launchOptions = launchOptions");
  expect(patched).toContain("var launchOptions: [UIApplication.LaunchOptionsKey: Any]?");
  expect(patched).toContain("class SceneDelegate: UIResponder, UIWindowSceneDelegate");
  expect(patched).not.toContain("window = UIWindow(frame: UIScreen.main.bounds)");
  expect(patched).toContain("let window = UIWindow(windowScene: windowScene)");
}

describe("patchAppDelegate", () => {
  it("moves RN window creation out of the Expo SDK 57 app delegate", () => {
    expectMovedWindow(patchAppDelegate(EXPO_SDK_57_APP_DELEGATE));
  });

  it("accepts compact and CRLF template formatting", () => {
    expectMovedWindow(
      patchAppDelegate(
        EXPO_SDK_57_APP_DELEGATE.replace("factory\n\n#if", "factory\n#if").replaceAll("\n", "\r\n"),
      ),
    );
  });

  it("is idempotent", () => {
    const patched = patchAppDelegate(EXPO_SDK_57_APP_DELEGATE);
    expect(patchAppDelegate(patched)).toBe(patched);
  });

  it("fails closed when the template no longer matches", () => {
    expect(() => patchAppDelegate("class AppDelegate {}\n")).toThrow(
      "Could not move React Native window creation out of AppDelegate",
    );
  });
});
