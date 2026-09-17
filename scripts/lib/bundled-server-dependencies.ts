import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

import { resolveCatalogDependencies } from "./resolve-catalog.ts";

/** Shared with tsdown: first-party runtime packages are embedded in the server bundle. */
export function isBundledServerDependency(name: string): boolean {
  return name.startsWith("@graft/");
}

export function resolveBundledServerDependencies(
  dependencies: Record<string, unknown>,
  catalog: Record<string, unknown>,
): Record<string, unknown> {
  const external = Object.fromEntries(
    Object.entries(dependencies).filter(([name, spec]) => {
      if (typeof spec !== "string" || !spec.startsWith("workspace:")) return true;
      if (!isBundledServerDependency(name)) {
        throw new Error(`Unbundled workspace dependency cannot be distributed: ${name}.`);
      }
      return false;
    }),
  );
  return resolveCatalogDependencies(external, catalog, "bundled server distribution");
}

export function assertNoBundledServerImports(source: string, filename: string): void {
  // TypeScript's scanner recognizes static import/export, dynamic import, and
  // CommonJS require without confusing comments or ordinary string values.
  const imports = ts.preProcessFile(source, true, true).importedFiles;
  for (const reference of imports) {
    if (isBundledServerDependency(reference.fileName)) {
      throw new Error(
        `Unresolved bundled dependency ${reference.fileName} remains in ${filename}.`,
      );
    }
  }
}

/** Validate generated Node entrypoints and chunks before omitting workspace packages. */
export function verifyBundledServerOutput(directory: string): void {
  let files = 0;
  const visit = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink())
        throw new Error(`Unexpected symlink in bundled server output: ${path}.`);
      if (info.isDirectory()) {
        // The browser bundle has a separate build and cannot provide Node dependencies.
        if (current !== directory || name !== "client") visit(path);
      } else if (/\.(?:mjs|cjs|js)$/.test(name)) {
        assertNoBundledServerImports(readFileSync(path, "utf8"), path);
        files++;
      }
    }
  };
  visit(directory);
  if (files === 0) throw new Error(`No bundled server JavaScript found in ${directory}.`);
}
