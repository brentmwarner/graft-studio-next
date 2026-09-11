import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const plugin = createRequire(import.meta.url)("./debugCleartextManifest.js") as {
  writeDebugCleartextManifest: (androidRoot: string) => string;
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function expoAndroidCleartext(config: {
  expo?: {
    android?: { usesCleartextTraffic?: boolean };
    plugins?: unknown[];
  };
}): boolean | undefined {
  if (config.expo?.android?.usesCleartextTraffic) return true;
  for (const pluginEntry of config.expo?.plugins ?? []) {
    if (!Array.isArray(pluginEntry) || pluginEntry[0] !== "expo-build-properties") continue;
    const value = (pluginEntry[1] as { android?: { usesCleartextTraffic?: boolean } } | undefined)
      ?.android?.usesCleartextTraffic;
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

describe("debug-only Android cleartext", () => {
  it("writes cleartext permission under the debug overlay, not the main manifest", () => {
    const androidRoot = mkdtempSync(join(tmpdir(), "graft-android-cleartext-"));
    roots.push(androidRoot);
    const written = plugin.writeDebugCleartextManifest(androidRoot);
    expect(written.endsWith(join("app", "src", "debug", "AndroidManifest.xml"))).toBe(true);
    const xml = readFileSync(written, "utf8");
    const application = /<application\b([^>]*)\/?>/u.exec(xml);
    const cleartext = /android:usesCleartextTraffic="(true|false)"/u.exec(application?.[1] ?? "");
    expect(cleartext?.[1]).toBe("true");
  });

  it("does not enable cleartext for release Expo builds", () => {
    const config = JSON.parse(
      readFileSync(join(dirname(import.meta.dirname), "app.json"), "utf8"),
    ) as {
      expo?: { android?: { usesCleartextTraffic?: boolean }; plugins?: unknown[] };
    };
    expect(expoAndroidCleartext(config)).toBeUndefined();
    expect(config.expo?.plugins).toContain("./plugins/withDebugCleartextTraffic.js");
  });
});
