// Export the exact Central artwork installed by legacy Graft as static SVGs.
// Run: node scripts/migrate-legacy-central-icons.mjs [legacy-checkout] [--check]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const legacyRoot = path.resolve(legacyPath ?? path.join(root, "../graft-studio"));
const check = process.argv.includes("--check");
const packageName = "@central-icons-react/round-outlined-radius-3-stroke-1.5";
const packageRoot = path.join(legacyRoot, "apps/desktop/node_modules", packageName);
const packageInfo = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
if (packageInfo.version !== "1.1.223") {
  throw new Error(`Expected legacy Central 1.1.223, got ${packageInfo.version}`);
}

// Resolve React and icon modules from the selected checkout, without adding a
// second React runtime or the full icon package to Graft Next's client bundle.
const legacyRequire = createRequire(path.join(legacyRoot, "apps/desktop/package.json"));
const { createElement } = legacyRequire("react");
const { renderToStaticMarkup } = legacyRequire("react-dom/server");
const iconExports = new Map();
for (const entry of fs.readdirSync(packageRoot)) {
  if (!entry.startsWith("Icon")) continue;
  const source = fs.readFileSync(path.join(packageRoot, entry, "index.mjs"), "utf8");
  const label = [...source.matchAll(/ariaLabel:"([^"]+)"/g)].at(-1)?.[1];
  if (label) iconExports.set(label.split(",")[0].trim(), entry);
}

const src = path.join(root, "apps/web/src");
const names = new Set();
for (const entry of fs.readdirSync(src, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.[jt]sx?$/.test(entry.name)) continue;
  if (/\.(test|browser|stories)\./.test(entry.name)) continue;
  const source = fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8");
  for (const [, name] of source.matchAll(/["'`]([a-z0-9][a-z0-9-]*)["'`]/g)) {
    if (iconExports.has(name)) names.add(name);
  }
}

const assets = path.join(root, "apps/web/public/central-icons-round");
const sortedNames = [...names].sort();
let differences = 0;
function writeOrCheck(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return;
  differences++;
  if (check) {
    console.error(`Out of date: ${path.relative(root, file)}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

for (const name of sortedNames) {
  const exportName = iconExports.get(name);
  const Icon = legacyRequire(`${packageName}/${exportName}`)[exportName];
  writeOrCheck(path.join(assets, `${name}.svg`), renderToStaticMarkup(createElement(Icon)) + "\n");
}
for (const file of fs.readdirSync(assets)) {
  if (!file.endsWith(".svg") || names.has(file.slice(0, -4))) continue;
  differences++;
  if (check) console.error(`Unused generated asset: ${file}`);
  else fs.unlinkSync(path.join(assets, file));
}
writeOrCheck(
  path.join(src, "lib/central-icons-round.json"),
  JSON.stringify(sortedNames, null, 2) + "\n",
);
writeOrCheck(
  path.join(root, "apps/web/CENTRAL-ICONS-LICENSE.md"),
  fs.readFileSync(path.join(packageRoot, "LICENSE.md"), "utf8"),
);
console.info(
  `${sortedNames.length} legacy Central icons; ${differences} ${check ? "differences" : "files updated"}.`,
);
if (check && differences > 0) process.exitCode = 1;
