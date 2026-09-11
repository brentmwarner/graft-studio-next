import { copyFile, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = join(
  repositoryRoot,
  "packages/mobile-contract/protocol-fixtures/mobile-v1/valid",
);
const defaultTarget = join(repositoryRoot, "apps/ios/GraftTests/Fixtures/mobile-v1");

export async function compareFixtureDirectories(sourcePath, targetPath) {
  const source = resolve(sourcePath);
  const target = resolve(targetPath);
  assertDistinctPaths(source, target);
  await assertDirectory(source, "Source");
  await assertDirectory(target, "Target");

  const sourceFiles = await collectJsonFiles(source);
  assertSourceHasFixtures(sourceFiles, source);
  const targetFiles = await collectJsonFiles(target);
  const sourceNames = new Set(sourceFiles);
  const targetNames = new Set(targetFiles);
  const missing = sourceFiles.filter((name) => !targetNames.has(name));
  const extra = targetFiles.filter((name) => !sourceNames.has(name));
  const changed = [];

  for (const name of sourceFiles) {
    if (!targetNames.has(name)) continue;
    const [sourceBytes, targetBytes] = await Promise.all([
      readFile(resolveFixturePath(source, name)),
      readFile(resolveFixturePath(target, name)),
    ]);
    if (!sourceBytes.equals(targetBytes)) changed.push(name);
  }

  return { changed, extra, missing, total: sourceFiles.length };
}

export async function syncFixtureDirectories(sourcePath, targetPath) {
  const source = resolve(sourcePath);
  const target = resolve(targetPath);
  assertDistinctPaths(source, target);
  assertSafeWriteTarget(target);
  await assertDirectory(source, "Source");

  const sourceFiles = await collectJsonFiles(source);
  assertSourceHasFixtures(sourceFiles, source);
  const targetExists = await pathExists(target);
  let targetFiles = [];
  if (targetExists) {
    await assertDirectory(target, "Target");
    targetFiles = await collectJsonFiles(target);
  } else {
    await mkdir(target, { recursive: true });
  }

  const sourceNames = new Set(sourceFiles);
  for (const name of targetFiles) {
    if (!sourceNames.has(name)) {
      await rm(resolveFixturePath(target, name));
    }
  }

  for (const name of sourceFiles) {
    const destination = resolveFixturePath(target, name);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolveFixturePath(source, name), destination);
  }

  return { total: sourceFiles.length };
}

export async function runFixtureCommand(args, output = { error: console.error, log: console.log }) {
  try {
    const options = parseArguments(args);
    if (options.help) {
      output.log(usage());
      return 0;
    }

    if (options.mode === "write") {
      const result = await syncFixtureDirectories(options.source, options.target);
      output.log(`Synced ${result.total} iOS protocol fixtures.`);
      return 0;
    }

    const result = await compareFixtureDirectories(options.source, options.target);
    const diagnostics = formatDiagnostics(result);
    if (diagnostics.length > 0) {
      output.error("iOS protocol fixtures are out of sync:");
      for (const diagnostic of diagnostics) output.error(`  ${diagnostic}`);
      output.error("Run `bun run sync:ios-fixtures` to repair the copy.");
      return 1;
    }

    output.log(`iOS protocol fixtures are in sync (${result.total} files).`);
    return 0;
  } catch (error) {
    output.error(`Fixture sync failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function parseArguments(args) {
  const options = {
    help: false,
    mode: undefined,
    source: defaultSource,
    target: defaultTarget,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--check":
      case "--write": {
        const mode = argument.slice(2);
        if (options.mode && options.mode !== mode) {
          throw new Error("Choose exactly one of --check or --write");
        }
        options.mode = mode;
        break;
      }
      case "--source":
      case "--target": {
        const value = args[index + 1];
        if (!value || value.startsWith("--")) {
          throw new Error(`${argument} requires a path`);
        }
        options[argument.slice(2)] = resolve(value);
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.help && !options.mode) {
    throw new Error("Choose --check or --write");
  }
  return options;
}

function formatDiagnostics(result) {
  return [
    ...result.missing.map((name) => `missing: ${name}`),
    ...result.extra.map((name) => `extra: ${name}`),
    ...result.changed.map((name) => `changed: ${name}`),
  ];
}

async function collectJsonFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Fixture directories must not contain symlinks: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(relative(root, absolutePath).split(sep).join("/"));
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function resolveFixturePath(root, relativePath) {
  const absolutePath = resolve(root, ...relativePath.split("/"));
  const prefix = `${resolve(root)}${sep}`;
  if (!absolutePath.startsWith(prefix)) {
    throw new Error(`Fixture path escapes its root: ${relativePath}`);
  }
  return absolutePath;
}

async function assertDirectory(path, label) {
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new Error(`${label} directory does not exist: ${path}`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} path must be a real directory: ${path}`);
  }
}

function assertDistinctPaths(source, target) {
  if (pathIsWithin(source, target) || pathIsWithin(target, source)) {
    throw new Error("Source and target directories must be different and non-nested");
  }
}

function pathIsWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!isAbsolute(pathFromParent) &&
      pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`))
  );
}

function assertSafeWriteTarget(target) {
  const filesystemRoot = parse(target).root;
  const targetDepth = relative(filesystemRoot, target).split(sep).filter(Boolean).length;
  if (target === filesystemRoot || target === repositoryRoot || targetDepth < 3) {
    throw new Error(`Refusing unsafe fixture target: ${target}`);
  }
}

function assertSourceHasFixtures(files, source) {
  if (files.length === 0) {
    throw new Error(`Source directory contains no JSON fixtures: ${source}`);
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function usage() {
  return [
    "Usage: node scripts/mobile-protocol-fixtures.mjs --check|--write",
    "       [--source <directory>] [--target <directory>]",
  ].join("\n");
}

const isCommandLine =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCommandLine) {
  process.exitCode = await runFixtureCommand(process.argv.slice(2));
}
