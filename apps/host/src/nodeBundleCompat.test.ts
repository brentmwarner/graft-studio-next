import { describe, expect, it } from "vitest";

import { rewriteNodeIncompatibleImports } from "./nodeBundleCompat";

describe("rewriteNodeIncompatibleImports", () => {
  it("replaces bun:sqlite so Node can load the bundled server", () => {
    const rewritten = rewriteNodeIncompatibleImports('import { Database } from "bun:sqlite";\n');
    const module = { exports: {} as { Database?: new () => unknown } };
    const loader = new Function("module", `${rewritten}\nmodule.exports = { Database };`);
    expect(() => loader(module)).not.toThrow();
    expect(() => new module.exports.Database!()).toThrow(/not available under Node/);
  });
});
