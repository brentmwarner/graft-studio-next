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

const WINDOW_CREATION_RE =
  /^([ \t]*)reactNativeDelegate\s*=\s*delegate\r?\n[ \t]*reactNativeFactory\s*=\s*factory\r?\n(?:[ \t]*\r?\n)*[ \t]*#if os\(iOS\) \|\| os\(tvOS\)\r?\n[\s\S]*?#endif\r?\n(?:[ \t]*\r?\n)*[ \t]*return super\.application\(application,\s*didFinishLaunchingWithOptions:\s*launchOptions\)/m;

function ensureLaunchOptionsProperty(contents) {
  if (/var launchOptions:\s*\[UIApplication\.LaunchOptionsKey:\s*Any\]\?/.test(contents)) {
    return contents;
  }
  return contents.replace(
    /^([ \t]*)var reactNativeFactory:\s*RCTReactNativeFactory\?\s*$/m,
    "$1var reactNativeFactory: RCTReactNativeFactory?\n$1var launchOptions: [UIApplication.LaunchOptionsKey: Any]?",
  );
}

function moveReactNativeWindowCreation(contents) {
  let replaced = false;
  const next = contents.replace(WINDOW_CREATION_RE, (match, indent) => {
    if (!/\bwindow\s*=\s*UIWindow\b/.test(match) || !/\bstartReactNative\s*\(/.test(match)) {
      return match;
    }
    replaced = true;
    return `${indent}reactNativeDelegate = delegate
${indent}reactNativeFactory = factory
${indent}self.launchOptions = launchOptions

${indent}return super.application(application, didFinishLaunchingWithOptions: launchOptions)`;
  });
  return { next, replaced };
}

function patchAppDelegate(contents) {
  if (contents.includes(MARKER)) return contents;
  const { next, replaced } = moveReactNativeWindowCreation(ensureLaunchOptionsProperty(contents));
  if (
    !replaced ||
    !next.includes("self.launchOptions = launchOptions") ||
    !/var launchOptions:\s*\[UIApplication\.LaunchOptionsKey:\s*Any\]\?/.test(next) ||
    /window\s*=\s*UIWindow\(frame:\s*UIScreen\.main\.bounds\)/.test(next)
  ) {
    throw new Error("Could not move React Native window creation out of AppDelegate");
  }
  return `${next.trimEnd()}\n${SCENE_DELEGATE}`;
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language === "swift") {
      mod.modResults.contents = patchAppDelegate(mod.modResults.contents);
    }
    return mod;
  });
}

module.exports = withIosSceneLifecycle;
module.exports.patchAppDelegate = patchAppDelegate;
