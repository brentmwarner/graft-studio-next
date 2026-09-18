import assert from "node:assert/strict";
import test from "node:test";

import { GRAFT_DESKTOP_UPDATE_GITHUB_RELEASES_URL } from "@graft/shared/desktopIdentity";
import { loadReleaseDownloads } from "../src/lib/releaseDownloads.ts";

const releases = GRAFT_DESKTOP_UPDATE_GITHUB_RELEASES_URL;
const latestAsset = (name) => `${releases}/latest/download/${name}`;
const releaseAsset = (version, name) => `${releases}/download/v${version}/${name}`;
const manifest = (version, files) =>
  `version: ${version}\nfiles:\n${files.map((url) => `  - url: ${url}\n    sha512: unused\n    size: 123`).join("\n")}\n`;
const fetcher = (objects) => async (url) =>
  new Response(objects[url] ?? "missing", {
    status: objects[url] === undefined ? 404 : 200,
  });

test("production installers resolve from the public GitHub release", async () => {
  const version = "0.9.0";
  const asset = (name) => releaseAsset(version, name);
  const downloads = await loadReleaseDownloads(
    fetcher({
      [latestAsset("latest-mac.yml")]: manifest(version, [
        `Graft-${version}-arm64.zip`,
        `Graft-${version}-x64.zip`,
      ]),
      [latestAsset("latest.yml")]: manifest(version, [`Graft-${version}-x64.exe`]),
      [latestAsset("latest-linux.yml")]: manifest(version, [`Graft-${version}-x86_64.AppImage`]),
      [releaseAsset(version, "release.json")]: JSON.stringify({
        version,
        sourceCommit: "a".repeat(40),
        artifacts: ["arm64", "x64"].map((arch) => ({
          pathname: `releases/${version}/Graft-${version}-${arch}.dmg`,
          url: asset(`Graft-${version}-${arch}.dmg`),
        })),
      }),
    }),
  );
  assert.equal(downloads.version, "v0.9.0");
  assert.equal(downloads.mac.arm64, asset(`Graft-${version}-arm64.dmg`));
  assert.equal(downloads.mac.x64, asset(`Graft-${version}-x64.dmg`));
  assert.equal(downloads.windows, asset(`Graft-${version}-x64.exe`));
  assert.equal(downloads.linux, asset(`Graft-${version}-x86_64.AppImage`));
  assert.equal(downloads.releasesUrl, `${releases}/tag/v${version}`);
});

test("mac installers resolve from exact release-index pathnames", async () => {
  const version = "0.9.0";
  const asset = (name) => releaseAsset(version, name);
  const downloads = await loadReleaseDownloads(
    fetcher({
      [latestAsset("latest-mac.yml")]: manifest(version, [
        asset(`Graft-${version}-arm64.zip`),
        asset(`Graft-${version}-x64.zip`),
      ]),
      [latestAsset("latest.yml")]: manifest(version, [asset(`Graft-${version}-x64.exe`)]),
      [latestAsset("latest-linux.yml")]: manifest(version, [
        asset(`Graft-${version}-x86_64.AppImage`),
      ]),
      [releaseAsset(version, "release.json")]: JSON.stringify({
        version,
        sourceCommit: "a".repeat(40),
        artifacts: ["arm64", "x64"].map((arch) => ({
          pathname: `releases/${version}/Graft-${version}-${arch}.dmg`,
        })),
      }),
    }),
  );
  assert.equal(downloads.mac.arm64, asset(`Graft-${version}-arm64.dmg`));
  assert.equal(downloads.mac.x64, asset(`Graft-${version}-x64.dmg`));
});

test("GitHub downloads are restricted to the release repository and manifest version", async () => {
  const downloads = await loadReleaseDownloads(
    fetcher({
      [latestAsset("latest-mac.yml")]: manifest("0.9.0", [
        "https://github.com/attacker/graft-studio-next/releases/download/v0.9.0/Graft-0.9.0-arm64.zip",
      ]),
      [latestAsset("latest.yml")]: manifest("0.9.0", [
        releaseAsset("9.9.9", "Graft-0.9.0-x64.exe"),
      ]),
      [latestAsset("latest-linux.yml")]: manifest("0.9.0", [
        `${releaseAsset("0.9.0", "Graft-0.9.0-x86_64.AppImage")}?download=1`,
      ]),
    }),
  );
  assert.equal(downloads.version, null);
  assert.equal(downloads.mac.arm64, null);
  assert.equal(downloads.windows, null);
  assert.equal(downloads.linux, null);
});

test("mismatched manifests are not presented as one release", async () => {
  const downloads = await loadReleaseDownloads(
    fetcher({
      [latestAsset("latest-mac.yml")]: manifest("0.9.0", [
        releaseAsset("0.9.0", "Graft-0.9.0-arm64.zip"),
      ]),
      [latestAsset("latest.yml")]: manifest("0.8.9", [
        releaseAsset("0.8.9", "Graft-0.8.9-x64.exe"),
      ]),
      [latestAsset("latest-linux.yml")]: manifest("0.8.9", [
        releaseAsset("0.8.9", "Graft-0.8.9-x86_64.AppImage"),
      ]),
    }),
  );
  assert.equal(downloads.version, null);
  assert.equal(downloads.windows, releaseAsset("0.8.9", "Graft-0.8.9-x64.exe"));
  assert.equal(downloads.mac.arm64, null);
});

test("invalid or unavailable metadata disables affected downloads without fallback", async () => {
  const downloads = await loadReleaseDownloads(
    fetcher({
      [latestAsset("latest.yml")]: manifest("0.9.0", ["https://attacker.example/Graft.exe"]),
      [latestAsset("latest-linux.yml")]: manifest("0.9.0", ["../outside/Graft.AppImage"]),
    }),
  );
  assert.equal(downloads.version, null);
  assert.equal(downloads.mac.arm64, null);
  assert.equal(downloads.windows, null);
  assert.equal(downloads.linux, null);
});
