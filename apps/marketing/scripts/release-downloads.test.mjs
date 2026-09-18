import assert from "node:assert/strict";
import test from "node:test";

import { GRAFT_DESKTOP_UPDATE_URL } from "@graft/shared/desktopIdentity";
import { loadReleaseDownloads } from "../src/lib/releaseDownloads.ts";

const feed = GRAFT_DESKTOP_UPDATE_URL;
const manifest = (version, files) =>
  `version: ${version}\nfiles:\n${files.map((url) => `  - url: ${url}\n    sha512: unused\n    size: 123`).join("\n")}\n`;
const fetcher = (objects) => async (url) =>
  new Response(objects[url] ?? "missing", { status: objects[url] === undefined ? 404 : 200 });

test("legacy installers come directly from the live feed, with no invented Intel artifact", async () => {
  const downloads = await loadReleaseDownloads(
    fetcher({
      [`${feed}/latest-mac.yml`]: manifest("0.1.143", [
        "Graft-0.1.143-arm64-mac.zip",
        "Graft-arm64.dmg",
      ]),
      [`${feed}/latest.yml`]: manifest("0.1.143", ["Graft-Setup-x64.exe"]),
      [`${feed}/latest-linux.yml`]: manifest("0.1.143", ["Graft-x64.AppImage"]),
    }),
  );
  assert.equal(downloads.version, "v0.1.143");
  assert.equal(downloads.mac.arm64, `${feed}/Graft-arm64.dmg`);
  assert.equal(downloads.mac.x64, null);
  assert.equal(downloads.windows, `${feed}/Graft-Setup-x64.exe`);
});

test("new mac installers resolve from the exact promoted version's immutable index", async () => {
  const version = "0.9.0";
  const downloads = await loadReleaseDownloads(
    fetcher({
      [`${feed}/latest-mac.yml`]: manifest(version, [
        `${version}/Graft-${version}-arm64.zip`,
        `${version}/Graft-${version}-x64.zip`,
      ]),
      [`${feed}/latest.yml`]: manifest(version, [`${version}/Graft-${version}-x64.exe`]),
      [`${feed}/latest-linux.yml`]: manifest(version, [
        `${version}/Graft-${version}-x86_64.AppImage`,
      ]),
      [`${feed}/${version}/release.json`]: JSON.stringify({
        version,
        sourceCommit: "a".repeat(40),
        artifacts: ["arm64", "x64"].map((arch) => ({
          pathname: `releases/${version}/Graft-${version}-${arch}.dmg`,
        })),
      }),
    }),
  );
  assert.equal(downloads.version, "v0.9.0");
  assert.equal(downloads.mac.x64, `${feed}/${version}/Graft-${version}-x64.dmg`);
  assert.equal(downloads.linux, `${feed}/${version}/Graft-${version}-x86_64.AppImage`);
  assert.equal(downloads.releasesUrl, `${feed}/${version}/release.json`);
});

test("production installers resolve from the trusted GitHub release", async () => {
  const version = "0.9.0";
  const release = `https://github.com/brentmwarner/graft-studio/releases/download/v${version}`;
  const downloads = await loadReleaseDownloads(
    fetcher({
      [`${feed}/latest-mac.yml`]: manifest(version, [
        `${release}/Graft-${version}-arm64.zip`,
        `${release}/Graft-${version}-x64.zip`,
      ]),
      [`${feed}/latest.yml`]: manifest(version, [`${release}/Graft-${version}-x64.exe`]),
      [`${feed}/latest-linux.yml`]: manifest(version, [
        `${release}/Graft-${version}-x86_64.AppImage`,
      ]),
      [`${feed}/${version}/release.json`]: JSON.stringify({
        version,
        sourceCommit: "a".repeat(40),
        artifacts: ["arm64", "x64"].map((arch) => ({
          pathname: `releases/${version}/Graft-${version}-${arch}.dmg`,
          url: `${release}/Graft-${version}-${arch}.dmg`,
        })),
      }),
    }),
  );
  assert.equal(downloads.version, "v0.9.0");
  assert.equal(downloads.mac.arm64, `${release}/Graft-${version}-arm64.dmg`);
  assert.equal(downloads.mac.x64, `${release}/Graft-${version}-x64.dmg`);
  assert.equal(downloads.windows, `${release}/Graft-${version}-x64.exe`);
  assert.equal(downloads.linux, `${release}/Graft-${version}-x86_64.AppImage`);
});

test("GitHub downloads are restricted to the release repository and manifest version", async () => {
  const downloads = await loadReleaseDownloads(
    fetcher({
      [`${feed}/latest-mac.yml`]: manifest("0.9.0", [
        "https://github.com/attacker/graft-studio/releases/download/v0.9.0/Graft-0.9.0-arm64.zip",
      ]),
      [`${feed}/latest.yml`]: manifest("0.9.0", [
        "https://github.com/brentmwarner/graft-studio/releases/download/v9.9.9/Graft-0.9.0-x64.exe",
      ]),
      [`${feed}/latest-linux.yml`]: manifest("0.9.0", [
        "https://github.com/brentmwarner/graft-studio/releases/download/v0.9.0/Graft-0.9.0-x86_64.AppImage?download=1",
      ]),
    }),
  );
  assert.equal(downloads.version, null);
  assert.equal(downloads.mac.arm64, null);
  assert.equal(downloads.windows, null);
  assert.equal(downloads.linux, null);
});

test("partial promotion follows each OS pointer without mislabeling one version", async () => {
  const downloads = await loadReleaseDownloads(
    fetcher({
      [`${feed}/latest-mac.yml`]: manifest("0.9.0", ["0.9.0/Graft-0.9.0-arm64.zip"]),
      [`${feed}/latest.yml`]: manifest("0.1.143", ["Graft-Setup-x64.exe"]),
      [`${feed}/latest-linux.yml`]: manifest("0.1.143", ["Graft-x64.AppImage"]),
    }),
  );
  assert.equal(downloads.version, null);
  assert.equal(downloads.windows, `${feed}/Graft-Setup-x64.exe`);
  assert.equal(downloads.mac.arm64, null);
});

test("invalid or unavailable metadata disables affected downloads without unrelated fallback", async () => {
  const downloads = await loadReleaseDownloads(
    fetcher({
      [`${feed}/latest.yml`]: manifest("0.9.0", ["https://attacker.example/Graft.exe"]),
      [`${feed}/latest-linux.yml`]: manifest("0.9.0", ["../outside/Graft.AppImage"]),
    }),
  );
  assert.equal(downloads.version, null);
  assert.equal(downloads.mac.arm64, null);
  assert.equal(downloads.windows, null);
  assert.equal(downloads.linux, null);
});
