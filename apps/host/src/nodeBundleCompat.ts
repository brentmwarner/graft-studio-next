const BUN_SQLITE_STUB = `{ Database: class Database { constructor() { throw new Error("bun:sqlite is not available under Node"); } } }`;

export function rewriteNodeIncompatibleImports(source: string): string {
  return source.replace(
    /import\s+\{([^}]+)\}\s+from\s+["']bun:sqlite["'];?/g,
    (_match, names: string) => {
      const bindings = names
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      return `const { ${bindings.join(", ")} } = ${BUN_SQLITE_STUB};`;
    },
  );
}
