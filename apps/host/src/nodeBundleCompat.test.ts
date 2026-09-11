import { describe, expect, it } from "vitest";

import { rewriteNodeIncompatibleImports } from "./nodeBundleCompat";

describe("rewriteNodeIncompatibleImports", () => {
  it("replaces bun:sqlite so Node can load the bundled server", () => {
    const rewritten = rewriteNodeIncompatibleImports(
      'import { Database } from "bun:sqlite";\nexport const ready = true;\n',
    );
    expect(rewritten).not.toContain("bun:sqlite");
    const module = { exports: {} as { Database?: new () => unknown } };
    const loader = new Function("module", `${rewritten}\nmodule.exports = { Database };`);
    loader(module);
    expect(() => new module.exports.Database!()).toThrow(/bun:sqlite is not available under Node/);
  });
});
