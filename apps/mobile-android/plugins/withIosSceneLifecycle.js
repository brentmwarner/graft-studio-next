const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const MARKER = "graft-ios-scene-lifecycle";

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: "Default Configuration",
        UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
      },
    ],
  },
};

const SCENE_DELEGATE = `
// ${MARKER}
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory
    else { return }

    let window = UIWindow(windowScene: windowScene)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: appDelegate.launchOptions)
    appDelegate.window = window
    self.window = window

    for context in connectionOptions.urlContexts {
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
    for activity in connectionOptions.userActivities {
      _ = RCTLinkingManager.application(
        UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

function patchAppDelegate(contents) {
  if (contents.includes(MARKER)) return contents;

  let next = contents.replace(
    "  var reactNativeFactory: RCTReactNativeFactory?",
    "  var reactNativeFactory: RCTReactNativeFactory?\n  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?",
  );

  next = next.replace(
    `    reactNativeDelegate = delegate
    reactNativeFactory = factory
#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`,
    `    reactNativeDelegate = delegate
    reactNativeFactory = factory
    self.launchOptions = launchOptions

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`,
  );

  if (!next.includes("self.launchOptions = launchOptions")) {
    throw new Error("Could not move React Native window creation out of AppDelegate");
  }

  return `${next.trimEnd()}\n${SCENE_DELEGATE}`;
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return mod;
  });

  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") return mod;
    mod.modResults.contents = patchAppDelegate(mod.modResults.contents);
    return mod;
  });

  return config;
}

module.exports = withIosSceneLifecycle;
