import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = join(repositoryRoot, "apps/mobile-android");
const iosRoot = join(repositoryRoot, "apps/ios");
const contractRoot = join(repositoryRoot, "packages/mobile-contract");

async function requireDirectory(path, label) {
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isDirectory()) {
    throw new Error(`${label} is missing at ${path}`);
  }
}

async function sourceFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (/\.(?:ts|tsx|swift)$/u.test(entry.name)) {
        files.push(path);
      }
    }
  }

  await visit(root);
  return files;
}

async function assertNoSynaraContractImports(root, label) {
  const violations = [];
  for (const path of await sourceFiles(root)) {
    const contents = await readFile(path, "utf8");
    if (contents.includes("@synara/contracts") || contents.includes("@synara/shared")) {
      violations.push(path.slice(repositoryRoot.length + 1));
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `${label} bypasses @graft/mobile-contract:\n${violations.map((path) => `  ${path}`).join("\n")}`,
    );
  }
}

await Promise.all([
  requireDirectory(androidRoot, "Android app"),
  requireDirectory(iosRoot, "iOS app"),
  requireDirectory(contractRoot, "Graft mobile contract"),
]);

const androidPackage = JSON.parse(
  await readFile(join(androidRoot, "package.json"), "utf8"),
);
if (androidPackage.dependencies?.["@graft/mobile-contract"] !== "workspace:*") {
  throw new Error("Android must depend on @graft/mobile-contract via workspace:*");
}
if (androidPackage.dependencies?.["@graft/shared"] !== undefined) {
  throw new Error("Android still depends on the legacy @graft/shared package");
}

await Promise.all([
  assertNoSynaraContractImports(androidRoot, "Android"),
  assertNoSynaraContractImports(iosRoot, "iOS"),
]);

console.log("Graft mobile boundary is intact: iOS and Android use the versioned Graft contract.");
