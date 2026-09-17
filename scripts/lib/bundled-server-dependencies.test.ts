import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertNoBundledServerImports,
  isBundledServerDependency,
  resolveBundledServerDependencies,
  verifyBundledServerOutput,
} from "./bundled-server-dependencies.ts";

describe("bundled server distribution dependencies", () => {
  it("omits exactly the workspace packages the bundler embeds and preserves external dependencies", () => {
    expect(
      resolveBundledServerDependencies(
        {
          "@graft/desktop-contract": "workspace:*",
          "@graft/mobile-contract": "workspace:*",
          "@graft/occupancy": "workspace:*",
          effect: "catalog:",
          "node-pty": "^1.1.0",
          "@graft/published-extension": "1.0.0",
        },
        { effect: "https://example.com/effect.tgz" },
      ),
    ).toEqual({
      effect: "https://example.com/effect.tgz",
      "node-pty": "^1.1.0",
      "@graft/published-extension": "1.0.0",
    });
    expect(isBundledServerDependency("@graft/desktop-contract")).toBe(true);
    expect(isBundledServerDependency("@another/runtime")).toBe(false);
    expect(() =>
      resolveBundledServerDependencies({ "@another/runtime": "workspace:*" }, {}),
    ).toThrow("Unbundled workspace dependency");
  });

  it.each([
    'import { schema } from "@graft/desktop-contract";',
    'export { schema } from "@graft/mobile-contract/subpath";',
    'await import("@graft/occupancy");',
    'const schema = require("@graft/contracts");',
  ])("rejects unresolved runtime imports in generated source: %s", (source) => {
    expect(() => assertNoBundledServerImports(source, "chunk.mjs")).toThrow(
      "Unresolved bundled dependency",
    );
  });

  it("does not confuse bundled module comments or data strings with imports", () => {
    expect(() =>
      assertNoBundledServerImports(
        `
      import { x } from "effect";
      // import { ignored } from "@graft/not-an-import";
      const label = '@graft/contracts';
      const example = 'import("@graft/example")';
    `,
        "chunk.mjs",
      ),
    ).not.toThrow();
  });

  it("scans emitted chunks as well as the entrypoint, and rejects missing output", () => {
    const root = mkdtempSync(join(tmpdir(), "graft-bundle-check-"));
    try {
      expect(() => verifyBundledServerOutput(root)).toThrow("No bundled server JavaScript");
      writeFileSync(join(root, "index.mjs"), 'import "./chunks/providers.mjs";');
      mkdirSync(join(root, "chunks"));
      writeFileSync(join(root, "chunks/providers.mjs"), 'export * from "@graft/occupancy";');
      expect(() => verifyBundledServerOutput(root)).toThrow("providers.mjs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
