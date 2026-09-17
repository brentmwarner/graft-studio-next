import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createPackagedDesktopSmokeEnvironment,
  parsePackagedDesktopStartupArgs,
  readPackagedStartupLogTails,
  retainMacBackendSampleCallGraph,
  resolvePackagedDependencySmokeLaunch,
  resolveNativePackagedDesktopPlatform,
  verifyPackagedRuntimeDependencies,
} from "./verify-packaged-desktop-startup.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("packaged desktop startup verification", () => {
  it("retains bounded failure diagnostics even when a startup log is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-startup-diagnostics-test-"));
    temporaryRoots.push(root);
    writeFileSync(join(root, "desktop-main.log"), "old entry" + "x".repeat(20_000) + "app ready");

    const diagnostics = readPackagedStartupLogTails(root);
    expect(diagnostics).toContain("app ready");
    expect(diagnostics).not.toContain("old entry");
    expect(diagnostics).toContain("server-child.log: unavailable");
    expect(diagnostics.length).toBeLessThan(16_500);
  });

  it("retains the macOS process call graph and removes the binary image list", () => {
    const callGraph = "Call graph:\n" + "node::sqlite".repeat(10_000);
    const diagnostics = retainMacBackendSampleCallGraph(
      `Sampling process 123\n${callGraph}\nBinary Images:\n${"library".repeat(10_000)}`,
    );

    expect(diagnostics).toContain("Sampling process 123");
    expect(diagnostics).toContain("Call graph:");
    expect(diagnostics).not.toContain("Binary Images:");
    expect(diagnostics.length).toBeLessThanOrEqual(65_536);
  });

  it("parses a bounded native payload request", () => {
    expect(
      parsePackagedDesktopStartupArgs([
        "--assets-dir",
        "./release-publish",
        "--platform",
        "linux",
        "--arch",
        "x64",
        "--version",
        "1.2.3",
      ]),
    ).toEqual({
      assetsDirectory: expect.stringMatching(/release-publish$/),
      platform: "linux",
      arch: "x64",
      version: "1.2.3",
      timeoutMs: 60_000,
    });

    expect(() =>
      parsePackagedDesktopStartupArgs([
        "--assets-dir",
        "./release-publish",
        "--platform",
        "linux",
        "--arch",
        "x64",
        "--version",
        "1.2.3",
        "--timeout-ms",
        "4999",
      ]),
    ).toThrow("--timeout-ms must be an integer between 5000 and 180000");
  });

  it("isolates user state and removes inherited runtime authority", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-packaged-smoke-env-test-"));
    temporaryRoots.push(root);

    const env = createPackagedDesktopSmokeEnvironment(
      root,
      { platform: "linux", version: "1.2.3" },
      {
        PATH: process.env.PATH,
        GRAFT_AUTH_TOKEN: "must-not-leak",
        ELECTRON_RUN_AS_NODE: "1",
      },
    );

    expect(env.GRAFT_AUTH_TOKEN).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    for (const name of [
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "XDG_DATA_HOME",
      "GRAFT_HOME",
    ] as const) {
      expect(env[name]?.startsWith(root)).toBe(true);
      expect(existsSync(env[name]!)).toBe(true);
    }
  });

  it("maps Node host platforms to release platform names", () => {
    expect(resolveNativePackagedDesktopPlatform("darwin")).toBe("mac");
    expect(resolveNativePackagedDesktopPlatform("win32")).toBe("win");
    expect(resolveNativePackagedDesktopPlatform("linux")).toBe("linux");
  });

  it("uses the bundled Node runtime with the physical unpacked server entry", () => {
    const root = join("root", "Resources");
    const bundledNode = join(root, "node-runtime", "node");

    expect(
      resolvePackagedDependencySmokeLaunch(
        { executable: join("root", "MacOS", "Graft"), resourcesDirectory: root },
        (candidate) => candidate === bundledNode,
      ),
    ).toEqual({
      entry: join(root, "app.asar.unpacked", "apps/server/dist/runtimeDependencySmoke.mjs"),
      executable: bundledNode,
      usesElectronNodeMode: false,
    });
  });

  it("rejects a missing packaged peer even when the development tree provides it", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-runtime-deps-test-"));
    temporaryRoots.push(root);
    const app = join(root, "app.asar");
    const dist = join(app, "apps/server/dist");
    const sdk = join(app, "node_modules/@agentclientprotocol/sdk");
    const developmentModules = join(root, "development/node_modules");
    const writeZod = (modules: string) => {
      const directory = join(modules, "zod");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "package.json"), '{"type":"module","exports":"./index.js"}');
      writeFileSync(join(directory, "index.js"), 'export const version = "test";');
    };
    mkdirSync(dist, { recursive: true });
    mkdirSync(sdk, { recursive: true });
    writeFileSync(
      join(dist, "runtimeDependencySmoke.mjs"),
      'await import("@agentclientprotocol/sdk");',
    );
    writeFileSync(join(sdk, "package.json"), '{"type":"module","exports":"./index.js"}');
    writeFileSync(join(sdk, "index.js"), 'export { version } from "zod";');
    writeZod(developmentModules);

    const runtime = { executable: process.execPath, resourcesDirectory: root };
    const env = {
      ...process.env,
      NODE_PATH: developmentModules,
      NODE_OPTIONS: "--invalid-development-node-option",
    };
    expect(() => verifyPackagedRuntimeDependencies(runtime, env, 5_000)).toThrow(
      /Cannot find package 'zod'/,
    );

    writeZod(join(app, "node_modules"));
    expect(() => verifyPackagedRuntimeDependencies(runtime, env, 5_000)).not.toThrow();
  });

  it("bounds a runtime import that never finishes", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-runtime-timeout-test-"));
    temporaryRoots.push(root);
    const dist = join(root, "app.asar/apps/server/dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "runtimeDependencySmoke.mjs"), "setInterval(() => {}, 1000);");

    expect(() =>
      verifyPackagedRuntimeDependencies(
        { executable: process.execPath, resourcesDirectory: root },
        process.env,
        200,
      ),
    ).toThrow(/ETIMEDOUT/);
  });
});
