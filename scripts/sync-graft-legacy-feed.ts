#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { put } from "@vercel/blob";
import { GRAFT_DESKTOP_UPDATE_URL } from "@graft/shared/desktopIdentity";

import { parseMacUpdateManifest } from "./lib/mac-update-manifests.ts";

const STABLE_MANIFESTS = ["latest-mac.yml", "latest.yml", "latest-linux.yml"] as const;

interface GitHubRelease {
  readonly isDraft: boolean;
  readonly isPrerelease: boolean;
  readonly tagName: string;
}

function runGh(args: ReadonlyArray<string>): string {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status === 0) return result.stdout;
  throw new Error(
    `GitHub CLI failed (${args.slice(0, 3).join(" ")}): ${result.stderr.trim() || "unknown error"}`,
  );
}

const repository = process.env.SOURCE_RELEASE_REPOSITORY || "";
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token)
  throw new Error("Legacy feed sync requires the public source repository and Blob token.");

const release = JSON.parse(
  runGh(["release", "view", "--repo", repository, "--json", "isDraft,isPrerelease,tagName"]),
) as GitHubRelease;
if (release.isDraft || release.isPrerelease || !/^v\d+\.\d+\.\d+$/.test(release.tagName))
  throw new Error("The public latest release must be a stable published version.");
const version = release.tagName.slice(1);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "graft-legacy-feed-"));

try {
  runGh([
    "release",
    "download",
    release.tagName,
    "--repo",
    repository,
    "--dir",
    temporaryDirectory,
    ...STABLE_MANIFESTS.flatMap((name) => ["--pattern", name]),
  ]);

  for (const name of STABLE_MANIFESTS) {
    const bytes = await readFile(join(temporaryDirectory, name));
    const manifest = parseMacUpdateManifest(bytes.toString("utf8"), name);
    if (manifest.version !== version) throw new Error(`${name} does not match ${release.tagName}.`);
    for (const file of manifest.files) {
      const url = new URL(file.url);
      const expectedPrefix = `/${repository}/releases/download/${release.tagName}/Graft-`;
      if (
        url.origin !== "https://github.com" ||
        !url.pathname.startsWith(expectedPrefix) ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        throw new Error(`${name} contains a noncanonical release URL.`);
      }
    }

    const pathname = `releases/${name}`;
    const uploaded = await put(pathname, bytes, {
      token,
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: "application/yaml",
    });
    const expected = new URL(GRAFT_DESKTOP_UPDATE_URL);
    const result = new URL(uploaded.url);
    if (result.origin !== expected.origin || result.pathname !== `/${pathname}`)
      throw new Error(`Blob token returned an unexpected path for ${name}.`);

    const verifyUrl = new URL(result);
    verifyUrl.searchParams.set("graft_legacy_feed_verify", randomUUID());
    const response = await fetch(verifyUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Legacy feed readback failed (${response.status}): ${name}.`);
    const readback = Buffer.from(await response.arrayBuffer());
    const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
    if (readback.byteLength !== bytes.byteLength || digest(readback) !== digest(bytes))
      throw new Error(`Legacy feed readback differs: ${name}.`);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Legacy updater bridge now points to public Graft ${version} release assets.`);
