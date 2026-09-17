// FILE: update-installer-downloads.mjs
// Purpose: Refreshes stored installer counts and latest direct download links.
// Layer: Maintenance script for the Codex daily automation
// Depends on: GitHub historical download counts, live Graft Blob feed, installer JSON snapshots

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadReleaseDownloads } from "../src/lib/releaseDownloads.ts";
import { GRAFT_DESKTOP_UPDATE_URL } from "@graft/shared/desktopIdentity";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const downloadsOutputPath = resolve(projectRoot, "src/data/installer-downloads.json");
const latestOutputPath = resolve(projectRoot, "src/data/latest-release-downloads.json");
const releasesApiUrl = "https://api.github.com/repos/brentmwarner/graft-studio-next/releases";
const installerFilePattern = /\.(dmg|exe|AppImage)$/i;

function createGitHubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

// Fetches every releases page so the stored figure remains a true all-time total.
async function fetchAllReleases() {
  const releases = [];

  for (let page = 1; ; page += 1) {
    const url = new URL(releasesApiUrl);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers: createGitHubHeaders() });

    if (!response.ok) {
      throw new Error(`GitHub Releases API failed: ${response.status} ${response.statusText}`);
    }

    const pageReleases = await response.json();

    if (!Array.isArray(pageReleases) || pageReleases.length === 0) {
      break;
    }

    releases.push(...pageReleases);
  }

  return releases;
}

function countInstallerDownloads(releases) {
  return releases.reduce((total, release) => {
    const releaseTotal =
      release.assets?.reduce((assetTotal, asset) => {
        if (!asset.name || !installerFilePattern.test(asset.name)) {
          return assetTotal;
        }

        return assetTotal + (asset.download_count ?? 0);
      }, 0) ?? 0;

    return total + releaseTotal;
  }, 0);
}

async function readExistingSnapshot(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

const releases = await fetchAllReleases();
const latestDownloads = await loadReleaseDownloads((url) =>
  fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" }),
);
const count = countInstallerDownloads(releases);

if (count <= 0) {
  throw new Error("Refusing to write an empty installer download count.");
}

if (!latestDownloads.version) {
  throw new Error("Refusing to snapshot unavailable or mixed-version stable download feeds.");
}

const previousSnapshot = await readExistingSnapshot(downloadsOutputPath);
const nextDownloadsSnapshot = {
  count,
  updatedAt: new Date().toISOString(),
  source: releasesApiUrl,
};
const nextLatestSnapshot = {
  ...latestDownloads,
  updatedAt: new Date().toISOString(),
  source: GRAFT_DESKTOP_UPDATE_URL,
};

await mkdir(dirname(downloadsOutputPath), { recursive: true });
await writeFile(downloadsOutputPath, `${JSON.stringify(nextDownloadsSnapshot, null, 2)}\n`);
await writeFile(latestOutputPath, `${JSON.stringify(nextLatestSnapshot, null, 2)}\n`);

const previousCount = previousSnapshot?.count ?? "unknown";
console.log(`Installer downloads: ${previousCount} -> ${count}`);
console.log(`Latest release downloads: ${nextLatestSnapshot.version}`);
