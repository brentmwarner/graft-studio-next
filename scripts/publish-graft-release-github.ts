#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  prepareGraftRelease,
  type GraftReleasePlan,
  type ReleaseObject,
  type UpgradeEvidence,
} from "./lib/graft-release-publisher.ts";
import { parseMacUpdateManifest, serializeMacUpdateManifest } from "./lib/mac-update-manifests.ts";

interface GitHubReleaseAsset {
  readonly digest: string | null;
  readonly name: string;
  readonly size: number;
  readonly state: string;
}

interface GitHubRelease {
  readonly assets: ReadonlyArray<GitHubReleaseAsset>;
  readonly isDraft: boolean;
  readonly isImmutable: boolean;
  readonly tagName: string;
}

const options = new Map<string, string>();
let publish = false;
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index]!;
  if (arg === "--publish" && !publish) {
    publish = true;
    continue;
  }
  if (
    !["--assets-dir", "--evidence"].includes(arg) ||
    options.has(arg) ||
    !process.argv[index + 1]
  ) {
    throw new Error(
      "Usage: node scripts/publish-graft-release-github.ts --assets-dir DIR --evidence FILE [--publish]",
    );
  }
  options.set(arg, process.argv[++index]!);
}

const assetsDirectory = options.get("--assets-dir");
const evidencePath = options.get("--evidence");
if (!assetsDirectory || !evidencePath)
  throw new Error("Both --assets-dir and --evidence are required.");

function releaseBytes(pathname: string, bytes: Uint8Array): ReleaseObject {
  return {
    pathname,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
    body: { bytes },
  };
}

function runGh(args: ReadonlyArray<string>, allowFailure = false): string | null {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status === 0) return result.stdout;
  if (allowFailure) return null;
  throw new Error(
    `GitHub CLI failed (${args.slice(0, 3).join(" ")}): ${result.stderr.trim() || "unknown error"}`,
  );
}

function readGitHubRelease(repository: string, tag: string): GitHubRelease | null {
  const output = runGh(
    ["release", "view", tag, "--repo", repository, "--json", "assets,isDraft,isImmutable,tagName"],
    true,
  );
  return output ? (JSON.parse(output) as GitHubRelease) : null;
}

function githubAssetUrl(repository: string, tag: string, fileName: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName))
    throw new Error(`Unsafe release asset name: ${fileName}.`);
  return `https://github.com/${repository}/releases/download/${tag}/${fileName}`;
}

function rewritePlanForGitHub(
  plan: GraftReleasePlan,
  repository: string,
  tag: string,
): GraftReleasePlan {
  const rewriteUrl = (value: string) => githubAssetUrl(repository, tag, basename(value));
  const manifests = plan.manifests.map((object) => {
    if (!("bytes" in object.body))
      throw new Error(`Expected generated manifest: ${object.pathname}.`);
    const parsed = parseMacUpdateManifest(
      Buffer.from(object.body.bytes).toString("utf8"),
      object.pathname,
    );
    const bytes = Buffer.from(
      serializeMacUpdateManifest({
        ...parsed,
        files: parsed.files.map((file) => ({
          ...file,
          url: rewriteUrl(file.url),
        })),
      }),
    );
    return releaseBytes(object.pathname, bytes);
  });
  const manifestsByName = new Map(manifests.map((object) => [basename(object.pathname), object]));
  const payloads = plan.payloads.map((object) => {
    const manifest = manifestsByName.get(basename(object.pathname));
    if (manifest) {
      if (!("bytes" in manifest.body)) throw new Error("Expected rewritten manifest bytes.");
      return releaseBytes(object.pathname, manifest.body.bytes);
    }
    if (basename(object.pathname) !== "release.json") return object;
    if (!("bytes" in object.body)) throw new Error("Expected generated release index.");
    const index = JSON.parse(Buffer.from(object.body.bytes).toString("utf8")) as {
      artifacts: Array<{
        pathname: string;
        sha256: string;
        size: number;
        url?: string;
      }>;
    };
    index.artifacts = index.artifacts.map((artifact) =>
      artifact.pathname.startsWith(`${plan.prefix}/Graft-`)
        ? { ...artifact, url: rewriteUrl(artifact.pathname) }
        : artifact,
    );
    return releaseBytes(object.pathname, Buffer.from(`${JSON.stringify(index, null, 2)}\n`));
  });
  return { ...plan, payloads, manifests };
}

function githubAssets(plan: GraftReleasePlan): ReadonlyArray<ReleaseObject> {
  const assets = new Map<string, ReleaseObject>();
  for (const object of plan.payloads) {
    const name = basename(object.pathname);
    const existing = assets.get(name);
    if (existing && (existing.sha256 !== object.sha256 || existing.size !== object.size))
      throw new Error(`Conflicting flattened GitHub release asset: ${name}.`);
    assets.set(name, object);
  }
  return [...assets.values()];
}

async function requirePublicAssets(
  objects: ReadonlyArray<ReleaseObject>,
  urls: ReadonlyArray<string>,
) {
  for (const [index, url] of urls.entries()) {
    const object = objects[index]!;
    let ready = false;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const response = await fetch(url, {
        headers: { range: "bytes=0-0" },
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const finalUrl = new URL(response.url);
      const isGitHubAssetHost = new Set([
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
      ]).has(finalUrl.hostname);
      const contentRange = response.headers.get("content-range");
      const contentLength = Number(response.headers.get("content-length"));
      const hasExactSize =
        (response.status === 206 && contentRange?.endsWith(`/${object.size}`)) ||
        (response.status === 200 && contentLength === object.size);
      await response.body?.cancel();
      if (isGitHubAssetHost && hasExactSize) {
        ready = true;
        break;
      }
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    if (!ready) throw new Error(`Published GitHub asset is not public: ${object.pathname}.`);
  }
}

const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as UpgradeEvidence;
const prepared = await prepareGraftRelease(assetsDirectory, evidence);
const repository = process.env.GITHUB_RELEASE_REPOSITORY || "";
const target = process.env.GITHUB_RELEASE_TARGET || "";
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || target !== prepared.sourceCommit)
  throw new Error(
    "GitHub release publication requires the public repository and exact source commit.",
  );
const tag = `v${prepared.version}`;
const plan = rewritePlanForGitHub(prepared, repository, tag);
const assets = githubAssets(plan);
const assetUrls = assets.map((object) =>
  githubAssetUrl(repository, tag, basename(object.pathname)),
);

console.log(
  `Validated ${plan.version} (${plan.sourceCommit}), four native platforms and ${assets.length} public GitHub release assets.`,
);

if (!publish) {
  console.log("Validation only. No release assets were uploaded.");
  process.exit(0);
}

if (!process.env.GH_TOKEN) throw new Error("Publication requires GH_TOKEN for GitHub Releases.");

let release = readGitHubRelease(repository, tag);
if (!release) {
  runGh([
    "release",
    "create",
    tag,
    "--repo",
    repository,
    "--target",
    target,
    "--draft",
    "--title",
    `Graft ${plan.version}`,
    "--notes",
    `Production desktop release ${plan.version} from graft-studio-next ${plan.sourceCommit}.`,
    "--latest=false",
  ]);
  release = readGitHubRelease(repository, tag);
}
if (!release || release.tagName !== tag) throw new Error(`Unable to create GitHub release ${tag}.`);

const readAsset = (object: ReleaseObject) => {
  const current = readGitHubRelease(repository, tag);
  const asset = current?.assets.find((entry) => entry.name === basename(object.pathname));
  return { asset, current };
};
const verifyGithubObject = (object: ReleaseObject) => {
  const { asset } = readAsset(object);
  if (!asset) return false;
  if (
    asset.state !== "uploaded" ||
    asset.size !== object.size ||
    asset.digest !== `sha256:${object.sha256}`
  ) {
    throw new Error(`GitHub release asset does not match provenance: ${object.pathname}.`);
  }
  return true;
};

const temporaryDirectory = await mkdtemp(join(tmpdir(), "graft-public-release-"));
try {
  for (const object of assets) {
    if (verifyGithubObject(object)) continue;
    const current = readGitHubRelease(repository, tag);
    if (!current?.isDraft)
      throw new Error(`Published GitHub release ${tag} is missing ${basename(object.pathname)}.`);
    const filePath =
      "filePath" in object.body
        ? object.body.filePath
        : join(temporaryDirectory, basename(object.pathname));
    if ("bytes" in object.body) await writeFile(filePath, object.body.bytes);
    runGh(["release", "upload", tag, filePath, "--repo", repository, "--clobber"]);
    if (!verifyGithubObject(object))
      throw new Error(`Uploaded GitHub asset is not verifiable: ${object.pathname}.`);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const current = readGitHubRelease(repository, tag);
if (!current) throw new Error(`Missing GitHub release ${tag}.`);
for (const object of assets) {
  if (!verifyGithubObject(object))
    throw new Error(`Missing GitHub release asset: ${object.pathname}.`);
}
if (current.isDraft) {
  runGh(["release", "edit", tag, "--repo", repository, "--draft=false", "--latest"]);
} else {
  runGh(["release", "edit", tag, "--repo", repository, "--latest"]);
}
const published = readGitHubRelease(repository, tag);
if (!published || published.isDraft) throw new Error(`GitHub release ${tag} is not public.`);
await requirePublicAssets(assets, assetUrls);

console.log(
  `Published ${plan.version}: https://github.com/${repository}/releases/tag/${tag} (${assets.length} verified assets).`,
);
