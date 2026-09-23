// FILE: release-smoke.ts
// Purpose: Smoke-tests release version alignment, release notes, and merged macOS updater manifests.
// Layer: Release verification script
// Depends on: update-release-package-versions.ts and merge-mac-update-manifests.ts.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GRAFT_DESKTOP_UPDATE_CHANNEL,
  GRAFT_DESKTOP_UPDATE_GITHUB_OWNER,
  GRAFT_DESKTOP_UPDATE_GITHUB_REPOSITORY,
  GRAFT_DESKTOP_UPDATE_URL,
  GRAFT_PRODUCTION_BUNDLE_ID,
} from "@graft/shared/desktopIdentity";

import {
  RELEASE_LOCKFILE_PATH,
  RELEASE_PATCHES_PATH,
  RELEASE_WORKSPACE_MANIFEST_PATHS,
} from "./lib/release-workspace-manifests.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function copyWorkspaceManifestFixture(targetRoot: string): void {
  for (const relativePath of RELEASE_WORKSPACE_MANIFEST_PATHS) {
    const sourcePath = resolve(repoRoot, relativePath);
    const destinationPath = resolve(targetRoot, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath);
  }
  cpSync(resolve(repoRoot, RELEASE_LOCKFILE_PATH), resolve(targetRoot, RELEASE_LOCKFILE_PATH));
  cpSync(resolve(repoRoot, RELEASE_PATCHES_PATH), resolve(targetRoot, RELEASE_PATCHES_PATH), {
    recursive: true,
  });
}

function writeMacManifestFixtures(targetRoot: string): { arm64Path: string; x64Path: string } {
  const assetDirectory = resolve(targetRoot, "release-assets");
  mkdirSync(assetDirectory, { recursive: true });

  const arm64Path = resolve(assetDirectory, "latest-mac.yml");
  const x64Path = resolve(assetDirectory, "latest-mac-x64.yml");

  writeFileSync(
    arm64Path,
    `version: 9.9.9-smoke.0
files:
  - url: Graft-9.9.9-smoke.0-arm64.zip
    sha512: arm64zip
    size: 125621344
path: Graft-9.9.9-smoke.0-arm64.zip
sha512: arm64zip
releaseDate: '2026-03-08T10:32:14.587Z'
`,
  );

  writeFileSync(
    x64Path,
    `version: 9.9.9-smoke.0
files:
  - url: Graft-9.9.9-smoke.0-x64.zip
    sha512: x64zip
    size: 132000112
path: Graft-9.9.9-smoke.0-x64.zip
sha512: x64zip
releaseDate: '2026-03-08T10:36:07.540Z'
`,
  );

  return { arm64Path, x64Path };
}

function assertContains(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(message);
  }
}

function assertNotContains(haystack: string, needle: string, message: string): void {
  if (haystack.includes(needle)) {
    throw new Error(message);
  }
}

function verifyCanonicalIdentity(): void {
  const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
    engines?: { node?: string };
  };
  const pinnedNodeVersion = readFileSync(resolve(repoRoot, ".node-version"), "utf8").trim();
  if (!/^\d+\.\d+\.\d+$/.test(pinnedNodeVersion)) {
    throw new Error("Production builds require an exact Node version in .node-version.");
  }
  if (rootPackage.engines?.node !== pinnedNodeVersion) {
    throw new Error("package.json and .node-version must pin the same exact Node version.");
  }
  const serverPackage = JSON.parse(
    readFileSync(resolve(repoRoot, "apps/server/package.json"), "utf8"),
  ) as { name?: string; bin?: Record<string, string> };
  if (serverPackage.name !== "@graft/cli") {
    throw new Error(`Expected CLI package @graft/cli, got ${serverPackage.name ?? "<missing>"}.`);
  }
  const expectedBinaries = {
    graft: "dist/index.mjs",
    "graft-restore-migration-backup": "dist/restoreMigrationBackup.mjs",
  };
  if (JSON.stringify(serverPackage.bin ?? {}) !== JSON.stringify(expectedBinaries)) {
    throw new Error(
      "Expected the CLI to expose only the Graft entry point and migration recovery binary.",
    );
  }
  if (GRAFT_PRODUCTION_BUNDLE_ID !== "com.graft.studio") {
    throw new Error(`Unexpected production bundle ID: ${GRAFT_PRODUCTION_BUNDLE_ID}.`);
  }
  if (GRAFT_DESKTOP_UPDATE_CHANNEL !== "latest") {
    throw new Error(`Unexpected desktop update channel: ${GRAFT_DESKTOP_UPDATE_CHANNEL}.`);
  }

  if (
    GRAFT_DESKTOP_UPDATE_URL !== "https://xvce84ljzxgawnao.public.blob.vercel-storage.com/releases"
  ) {
    throw new Error("Production must retain the legacy upgrade bridge feed.");
  }
  if (
    GRAFT_DESKTOP_UPDATE_GITHUB_OWNER !== "brentmwarner" ||
    GRAFT_DESKTOP_UPDATE_GITHUB_REPOSITORY !== "graft-studio-next"
  ) {
    throw new Error("New production builds must use the public Graft GitHub update feed.");
  }
}

function verifyReleaseNotes(): void {
  const webPackage = JSON.parse(
    readFileSync(resolve(repoRoot, "apps/web/package.json"), "utf8"),
  ) as { version?: string };
  const version = webPackage.version;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("The desktop release needs a stable web package version.");
  }
  const releaseNoteMarkers: ReadonlyArray<readonly [string, string]> = [
    ["CHANGELOG.md", `## ${version} - `],
    ["apps/web/src/whatsNew/entries.ts", `version: "${version}"`],
    ["apps/marketing/src/data/changelog.ts", `version: "${version}"`],
  ];
  for (const [file, marker] of releaseNoteMarkers) {
    if (!readFileSync(resolve(repoRoot, file), "utf8").includes(marker)) {
      throw new Error(`Release ${version} is missing notes in ${file}.`);
    }
  }
}

function verifyReleaseWorkflowSafety(): void {
  const workflow = readFileSync(
    resolve(repoRoot, ".github/workflows/release.yml"),
    "utf8",
  ).replaceAll("\r\n", "\n");
  assertContains(
    workflow,
    "permissions:\n  contents: read",
    "Release jobs must default to read-only repository access.",
  );
  assertNotContains(workflow, "  push:", "Tag pushes must not promote the production feed.");
  assertContains(
    workflow,
    "default: build",
    "Manual release operations must default to build-only.",
  );
  assertContains(
    workflow,
    "repository: brentmwarner/graft-studio-next",
    "Native builds must use the current product repository.",
  );
  assertContains(
    workflow,
    "source_commit:\n        description: Full graft-studio-next commit SHA from its main branch\n        type: string\n        required: true",
    "Hosted production releases must require an explicit current-product source commit.",
  );
  assertContains(
    workflow,
    'git merge-base --is-ancestor "$SOURCE_COMMIT" refs/remotes/origin/main',
    "Secret-bearing builds must accept only source merged into graft-studio-next/main.",
  );
  assertContains(
    workflow,
    "node scripts/graft-release-source.ts",
    "Builds must verify the exact requested source commit.",
  );
  assertContains(
    workflow,
    'git reset --hard "$SOURCE_COMMIT"',
    "Native build jobs must restore the exact reviewed source after dependency setup.",
  );
  assertContains(
    workflow,
    "node scripts/verify-packaged-desktop-startup.ts",
    "Every native build must pass isolated packaged startup.",
  );
  assertContains(
    workflow,
    "name: graft-upgrade-evidence",
    "Promotion must consume separate native upgrade evidence.",
  );
  assertContains(
    workflow,
    "workflow_id: 'graft-next-upgrade-evidence.yml'",
    "Promotion must bind upgrade evidence to the dedicated host workflow.",
  );
  assertContains(
    workflow,
    "node scripts/publish-graft-release.ts",
    "Promotion must validate the complete release plan before publication.",
  );
  assertContains(
    workflow,
    "node scripts/publish-graft-release-github.ts",
    "Promotion must publish the verified plan to the public GitHub release.",
  );
  assertContains(
    workflow,
    "GITHUB_RELEASE_REPOSITORY: brentmwarner/graft-studio-next",
    "Promotion must pin the public update repository.",
  );
  assertNotContains(
    workflow,
    "GRAFT_ALLOW_UNSIGNED_WINDOWS_RELEASE",
    "Production must not bypass Windows signature verification.",
  );

  const evidenceWorkflow = readFileSync(
    resolve(repoRoot, ".github/workflows/graft-next-upgrade-evidence.yml"),
    "utf8",
  ).replaceAll("\r\n", "\n");
  assertContains(
    evidenceWorkflow,
    "source_commit:\n        description: Full graft-studio-next commit SHA from its main branch\n        type: string\n        required: true",
    "Upgrade evidence must require the exact current-product source commit.",
  );
  assertContains(
    evidenceWorkflow,
    'git merge-base --is-ancestor "$SOURCE_COMMIT" refs/remotes/origin/main',
    "Upgrade evidence must accept only source merged into graft-studio-next/main.",
  );
  assertContains(
    evidenceWorkflow,
    "workflowFile = context.repo.repo === 'graft-studio'",
    "Upgrade evidence must bind artifacts to the production build workflow on its host.",
  );
  assertContains(
    evidenceWorkflow,
    "node scripts/publish-graft-release.ts --assets-dir release-assets --evidence upgrade-evidence.json",
    "Upgrade evidence must validate every receipt against the signed native artifacts.",
  );
  assertContains(
    evidenceWorkflow,
    "name: graft-upgrade-evidence",
    "The evidence workflow must upload the artifact consumed by promotion.",
  );

  const cliScript = readFileSync(resolve(repoRoot, "apps/server/scripts/cli.ts"), "utf8");
  assertContains(
    cliScript,
    "makeTempDirectoryScoped",
    "Expected CLI publication to build an exclusively owned temporary package tree.",
  );
  assertContains(
    cliScript,
    "cwd: stagedPackageDir",
    "Expected npm publication to run only from the isolated CLI stage.",
  );
  assertContains(
    cliScript,
    "Staged CLI bin target is missing its Node shebang",
    "Expected staged CLI commands to remain executable npm bin entries.",
  );
  assertNotContains(
    cliScript,
    ".publish-bak",
    "CLI publication must not mutate and restore source-tree assets.",
  );

  const desktopBuildConfig = readFileSync(
    resolve(repoRoot, "apps/desktop/tsdown.config.mts"),
    "utf8",
  );
  assertContains(
    desktopBuildConfig,
    "__GRAFT_WINDOWS_UPDATER_PUBLISHER__",
    "Expected the Windows updater publisher identity to be compiled into the main bundle.",
  );

  const updaterSecurity = readFileSync(
    resolve(repoRoot, "apps/desktop/src/electronUpdaterSecurity.ts"),
    "utf8",
  );
  assertNotContains(
    updaterSecurity,
    "return feedPublisherNames",
    "Runtime signature verification must not trust publisher names from mutable updater config.",
  );
}

function verifyDesktopStageLockAuthority(): void {
  const buildScript = readFileSync(resolve(repoRoot, "scripts/build-desktop-artifact.ts"), "utf8");
  const gitAttributes = readFileSync(resolve(repoRoot, ".gitattributes"), "utf8");
  assertContains(
    gitAttributes,
    "bun.lock text eol=lf",
    "Expected bun.lock to retain byte-identical LF endings on every release runner.",
  );
  assertContains(
    buildScript,
    "bun install --frozen-lockfile --ignore-scripts --linker hoisted",
    "Expected macOS and Linux desktop staging to install from the repository's frozen workspace lockfile.",
  );
  assertContains(
    buildScript,
    'if (platform === "win")',
    "Expected Windows staging to use its explicit Bun lockfile-workaround path.",
  );
  assertContains(
    buildScript,
    "bun install --omit=dev --ignore-scripts --linker hoisted",
    "Expected Windows staging to omit dev dependencies without Bun's implicitly frozen production mode.",
  );
  assertNotContains(
    buildScript,
    "--production --frozen-lockfile",
    "Desktop staging must avoid Bun's divergent frozen production-workspace lockfile resolution.",
  );
  assertNotContains(
    buildScript,
    "bun install --production",
    "Windows staging must not use Bun's production flag because it implicitly forces frozen mode.",
  );
  assertNotContains(
    buildScript,
    "--filter @graft/",
    "Desktop staging must not use Bun workspace filters because filtered hoisted installs can diverge from bun.lock.",
  );
  assertContains(
    buildScript,
    ")`npm rebuild node-pty --foreground-scripts`,",
    "Expected Linux desktop staging to build only node-pty after the script-free frozen install.",
  );
  assertNotContains(
    buildScript,
    "npm rebuild --foreground-scripts",
    "Desktop staging must never enable every dependency lifecycle script.",
  );
  assertNotContains(
    buildScript,
    "bun pm trust --all",
    "Desktop staging must never trust every dependency lifecycle script.",
  );
  assertContains(
    buildScript,
    'createRequire(new URL("./package.json", import.meta.url))',
    "Expected desktop packaging to resolve dependencies from the owning scripts workspace.",
  );
  assertContains(
    buildScript,
    'requireFromScriptsWorkspace.resolve("electron-builder/cli.js")',
    "Expected desktop packaging to resolve electron-builder across Bun hoisting layouts.",
  );
  assertContains(
    buildScript,
    "`${process.execPath} ${electronBuilderCliPath}",
    "Expected desktop packaging to invoke electron-builder through Node without platform-specific bin shims.",
  );
  assertNotContains(
    buildScript,
    "electron-builder.cmd",
    "Desktop packaging must not depend on a Windows bin shim that Bun may hoist elsewhere.",
  );
  assertContains(
    buildScript,
    "graftCommitHash: commitHash",
    "Expected the staged package to carry its exact source commit.",
  );
  assertContains(
    buildScript,
    "graftLockfileSha256: resolvedLockfileSha256",
    "Expected the staged package to carry its repository lockfile digest.",
  );
  assertContains(
    buildScript,
    "graftWindowsPublisherSubject: resolvedBuildConfig.windowsPublisherSubject",
    "Expected signed Windows packages to carry the independently configured certificate subject DN.",
  );

  const lockfile = readFileSync(resolve(repoRoot, RELEASE_LOCKFILE_PATH), "utf8");
  const packagesSectionOffset = lockfile.indexOf('\n  "packages": {');
  if (packagesSectionOffset < 0) {
    throw new Error("Expected bun.lock to contain a packages section.");
  }
  const workspaceImporters = lockfile.slice(0, packagesSectionOffset);
  for (const manifestPath of RELEASE_WORKSPACE_MANIFEST_PATHS) {
    const workspacePath = manifestPath === "package.json" ? "" : dirname(manifestPath);
    if (!workspaceImporters.includes(`${JSON.stringify(workspacePath)}: {`)) {
      throw new Error(`Expected ${manifestPath} to have a matching importer in bun.lock.`);
    }
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), "graft-release-smoke-"));

try {
  verifyCanonicalIdentity();
  verifyReleaseNotes();
  verifyReleaseWorkflowSafety();
  verifyDesktopStageLockAuthority();
  copyWorkspaceManifestFixture(tempRoot);

  execFileSync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/update-release-package-versions.ts"),
      "9.9.9-smoke.0",
      "--root",
      tempRoot,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  execFileSync("bun", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  const lockfile = readFileSync(resolve(tempRoot, "bun.lock"), "utf8");
  assertContains(
    lockfile,
    `"version": "9.9.9-smoke.0"`,
    "Expected bun.lock to contain the smoke version.",
  );

  const { arm64Path, x64Path } = writeMacManifestFixtures(tempRoot);
  execFileSync(
    process.execPath,
    [resolve(repoRoot, "scripts/merge-mac-update-manifests.ts"), arm64Path, x64Path],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  const mergedManifest = readFileSync(arm64Path, "utf8");
  assertContains(
    mergedManifest,
    "Graft-9.9.9-smoke.0-arm64.zip",
    "Merged manifest is missing the arm64 asset.",
  );
  assertContains(
    mergedManifest,
    "Graft-9.9.9-smoke.0-x64.zip",
    "Merged manifest is missing the x64 asset.",
  );
  assertNotContains(
    mergedManifest,
    ".dmg",
    "macOS updater manifests must describe only the finalized ZIP artifacts.",
  );

  console.log("Release smoke checks passed.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
