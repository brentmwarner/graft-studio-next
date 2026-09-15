import type { ConfigContext, ExpoConfig } from "expo/config";

export default function configureApp({ config }: ConfigContext): ExpoConfig {
  if (process.env.EAS_BUILD_PROFILE !== "preview") return config;

  // Preview APKs connect to local and tailnet HTTP hosts during device testing.
  // Production keeps the existing HTTPS-only policy; debug uses its manifest overlay.
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ["expo-build-properties", { android: { usesCleartextTraffic: true } }],
    ],
  };
}
