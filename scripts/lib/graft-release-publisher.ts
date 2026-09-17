import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  mergeMacUpdateManifests,
  parseMacUpdateManifest,
  serializeMacUpdateManifest,
} from "./mac-update-manifests.ts";
import {
  MAC_MINIMUM_DARWIN_VERSION,
  WINDOWS_MINIMUM_SYSTEM_VERSION,
} from "./desktop-platform-build-config.ts";
import type { ReleaseArtifactProvenanceManifest } from "./release-artifact-provenance.ts";

export const RELEASE_PLATFORMS = ["mac-arm64", "mac-x64", "win-x64", "linux-x64"] as const;
export const STABLE_MANIFESTS = ["latest-mac.yml", "latest.yml", "latest-linux.yml"] as const;
export const UPGRADE_CHECKS = [
  "legacy-update",
  "account-continuity",
  "history-preserved",
  "settings-preserved",
  "reconnect",
  "rollback",
] as const;

export const NO_LEGACY_RELEASE_CHECKS = ["legacy-update", "rollback"] as const;

type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];
const INITIAL_CUTOVER_PREVIOUS_ARTIFACTS: Record<ReleasePlatform, string | null> = {
  "mac-arm64": "Graft-0.1.143-arm64-mac.zip",
  "mac-x64": null,
  "win-x64": "Graft-Setup-x64.exe",
  "linux-x64": "Graft-x64.AppImage",
};
export interface UpgradeEvidence {
  readonly schemaVersion: 2;
  readonly version: string;
  readonly sourceCommit: string;
  readonly previousVersions: Record<(typeof STABLE_MANIFESTS)[number], string>;
  readonly platforms: ReadonlyArray<{
    readonly platform: ReleasePlatform;
    readonly artifact: string;
    readonly sha256: string;
    readonly evidenceUrl: string;
    readonly previousArtifact: string | null;
    readonly checks: Record<
      (typeof UPGRADE_CHECKS)[number],
      "passed" | "not-applicable-no-legacy-release"
    >;
  }>;
}

export interface ReleaseObject {
  readonly pathname: string;
  readonly sha256: string;
  readonly size: number;
  readonly body: { readonly filePath: string } | { readonly bytes: Uint8Array };
}

export interface ReleaseStore {
  /** Read small JSON/YAML objects only. Null means a confirmed 404. */
  read(pathname: string): Promise<Uint8Array | null>;
  /** Streams and verifies all downloaded bytes. False means a confirmed 404. */
  verify(object: ReleaseObject): Promise<boolean>;
  put(object: ReleaseObject, overwrite: boolean): Promise<void>;
}

export interface GraftReleasePlan {
  readonly version: string;
  readonly sourceCommit: string;
  readonly prefix: string;
  readonly payloads: ReadonlyArray<ReleaseObject>;
  readonly manifests: ReadonlyArray<ReleaseObject>;
  readonly evidence: UpgradeEvidence;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function releaseBytes(pathname: string, bytes: Uint8Array): ReleaseObject {
  return { pathname, body: { bytes }, sha256: sha256(bytes), size: bytes.byteLength };
}

function requireStableVersion(value: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(value))
    throw new Error(`Expected a stable release version, got ${value}.`);
}

function greaterVersion(next: string, previous: string): boolean {
  requireStableVersion(next);
  requireStableVersion(previous);
  const left = next.split(".").map(Number);
  const right = previous.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index]! > right[index]!;
  }
  return false;
}

function artifactName(value: string, version: string): void {
  if (
    value !== basename(value) ||
    !/^Graft-[A-Za-z0-9._-]+$/.test(value) ||
    !value.includes(`-${version}-`)
  ) {
    throw new Error(`Release payload must have an immutable versioned Graft filename: ${value}.`);
  }
}

async function fileDigest(
  filePath: string,
  algorithm: "sha256" | "sha512",
  encoding: "hex" | "base64",
): Promise<string> {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest(encoding);
}

export function validateUpgradeEvidence(
  evidence: UpgradeEvidence,
  version: string,
  sourceCommit: string,
  artifacts: ReadonlyMap<string, ReleaseObject>,
): void {
  if (
    evidence.schemaVersion !== 2 ||
    evidence.version !== version ||
    evidence.sourceCommit !== sourceCommit
  ) {
    throw new Error("Upgrade evidence does not describe this exact release source and version.");
  }
  if (
    evidence.platforms.length !== RELEASE_PLATFORMS.length ||
    new Set(evidence.platforms.map((entry) => entry.platform)).size !== RELEASE_PLATFORMS.length
  ) {
    throw new Error("Upgrade evidence must cover each native platform exactly once.");
  }
  for (const platform of RELEASE_PLATFORMS) {
    const receipt = evidence.platforms.find((entry) => entry.platform === platform);
    const payload = receipt ? artifacts.get(receipt.artifact) : undefined;
    if (!receipt || !payload || payload.sha256 !== receipt.sha256)
      throw new Error(`Missing exact-artifact upgrade proof for ${platform}.`);
    const extension = platform.startsWith("mac-")
      ? ".zip"
      : platform === "win-x64"
        ? ".exe"
        : ".AppImage";
    const arch = platform === "linux-x64" ? "x86_64" : platform.endsWith("arm64") ? "arm64" : "x64";
    if (!receipt.artifact.endsWith(extension) || !receipt.artifact.includes(`-${arch}.`)) {
      throw new Error(`Upgrade proof for ${platform} names the wrong platform artifact.`);
    }
    const evidenceUrl = new URL(receipt.evidenceUrl);
    if (evidenceUrl.protocol !== "https:" || evidenceUrl.username || evidenceUrl.password)
      throw new Error(`Invalid evidence URL for ${platform}.`);
    const isInitialCutover =
      version === "0.9.0" &&
      Object.values(evidence.previousVersions).every((previous) => previous === "0.1.143");
    if (
      isInitialCutover &&
      receipt.previousArtifact !== INITIAL_CUTOVER_PREVIOUS_ARTIFACTS[platform]
    ) {
      throw new Error(`Wrong 0.1.143 predecessor artifact for ${platform}.`);
    }
    const hasNoLegacyRelease = receipt.previousArtifact === null;
    if (hasNoLegacyRelease && !(isInitialCutover && platform === "mac-x64")) {
      throw new Error(
        `Only the unreleased Intel Mac 0.1.143 to 0.9.0 cutover may omit a legacy artifact.`,
      );
    }
    if (
      receipt.previousArtifact !== null &&
      (receipt.previousArtifact !== basename(receipt.previousArtifact) || !receipt.previousArtifact)
    ) {
      throw new Error(`Invalid previous release artifact for ${platform}.`);
    }
    for (const check of UPGRADE_CHECKS) {
      const canBeNotApplicable =
        hasNoLegacyRelease && (NO_LEGACY_RELEASE_CHECKS as ReadonlyArray<string>).includes(check);
      const expected = canBeNotApplicable ? "not-applicable-no-legacy-release" : "passed";
      if (receipt.checks[check] !== expected)
        throw new Error(`${platform} has no passing ${check} evidence.`);
    }
  }
  for (const name of STABLE_MANIFESTS) {
    if (!greaterVersion(version, evidence.previousVersions[name]))
      throw new Error(`Release must advance ${name}.`);
  }
}

/** Validates native provenance before combining manifests; no source files are overwritten. */
export async function prepareGraftRelease(
  assetsDirectory: string,
  evidence: UpgradeEvidence,
): Promise<GraftReleasePlan> {
  const { version, sourceCommit } = evidence;
  requireStableVersion(version);
  if (!/^[a-f0-9]{40}$/.test(sourceCommit))
    throw new Error("Release source must be a full commit SHA.");
  const entries = (await readdir(assetsDirectory)).sort();
  const payloads = new Map<string, ReleaseObject>();
  const provenances: ReleaseArtifactProvenanceManifest[] = [];
  const prefix = `releases/${version}`;
  for (const fileName of entries.filter((name) => name.endsWith(".provenance.json"))) {
    const raw = await readFile(join(assetsDirectory, fileName));
    const provenance = JSON.parse(raw.toString()) as ReleaseArtifactProvenanceManifest;
    if (
      provenance.schemaVersion !== 1 ||
      provenance.version !== version ||
      provenance.source.commit !== sourceCommit
    ) {
      throw new Error(`Artifact provenance does not match release source: ${fileName}.`);
    }
    if (!/^[a-f0-9]{64}$/.test(provenance.source.lockfileSha256))
      throw new Error(`Invalid lockfile provenance: ${fileName}.`);
    const key = `${provenance.platform}-${provenance.arch}`;
    if (!(RELEASE_PLATFORMS as ReadonlyArray<string>).includes(key))
      throw new Error(`Unsupported publication platform: ${key}.`);
    if (provenances.some((entry) => `${entry.platform}-${entry.arch}` === key))
      throw new Error(`Duplicate native provenance: ${key}.`);
    if (
      provenance.platform === "linux"
        ? provenance.signing.status !== "not-applicable"
        : provenance.signing.status !== "verified"
    ) {
      throw new Error(`Publication requires verified native signatures: ${key}.`);
    }
    if (
      (provenance.platform === "mac" && provenance.signing.scheme !== "apple-developer-id") ||
      (provenance.platform === "win" && provenance.signing.scheme !== "windows-authenticode")
    ) {
      throw new Error(`Wrong signature scheme for ${key}.`);
    }
    for (const artifact of provenance.artifacts) {
      if (artifact.fileName !== basename(artifact.fileName))
        throw new Error("Unsafe provenance filename.");
      const filePath = join(assetsDirectory, artifact.fileName);
      const info = await lstat(filePath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size !== artifact.size ||
        (await fileDigest(filePath, "sha256", "hex")) !== artifact.sha256
      ) {
        throw new Error(`Artifact bytes differ from native provenance: ${artifact.fileName}.`);
      }
      if (/\.(exe|zip|dmg|AppImage|blockmap)$/.test(artifact.fileName)) {
        artifactName(artifact.fileName, version);
        if (payloads.has(artifact.fileName))
          throw new Error(`Duplicate native payload: ${artifact.fileName}.`);
        payloads.set(artifact.fileName, {
          pathname: `${prefix}/${artifact.fileName}`,
          body: { filePath },
          size: info.size,
          sha256: artifact.sha256,
        });
      }
    }
    provenances.push(provenance);
    payloads.set(fileName, releaseBytes(`${prefix}/${fileName}`, raw));
  }
  if (provenances.length !== RELEASE_PLATFORMS.length)
    throw new Error("All four native build provenances are required.");
  if (new Set(provenances.map((entry) => entry.source.lockfileSha256)).size !== 1)
    throw new Error("Native builds used different lockfiles.");
  const macIdentities = provenances
    .filter((entry) => entry.platform === "mac")
    .map((entry) =>
      entry.signing.scheme === "apple-developer-id" ? entry.signing.identity.teamId : null,
    );
  if (new Set(macIdentities).size !== 1 || !macIdentities[0])
    throw new Error("macOS builds must use the same Developer ID team.");
  validateUpgradeEvidence(evidence, version, sourceCommit, payloads);
  const manifests: ReleaseObject[] = [];
  for (const name of STABLE_MANIFESTS) {
    const parse = async (filename: string) =>
      parseMacUpdateManifest(await readFile(join(assetsDirectory, filename), "utf8"), filename);
    const manifest =
      name === "latest-mac.yml"
        ? mergeMacUpdateManifests(await parse(name), await parse("latest-mac-x64.yml"))
        : await parse(name);
    if (manifest.version !== version) throw new Error(`Wrong manifest version: ${name}.`);
    const minimumSystemVersion =
      name === "latest-mac.yml"
        ? MAC_MINIMUM_DARWIN_VERSION
        : name === "latest.yml"
          ? WINDOWS_MINIMUM_SYSTEM_VERSION
          : undefined;
    if (minimumSystemVersion && manifest.extras.minimumSystemVersion !== minimumSystemVersion) {
      throw new Error(
        `Missing compatible OS version gate in ${name}; expected ${minimumSystemVersion}.`,
      );
    }
    const expectedFiles =
      name === "latest-mac.yml"
        ? [`Graft-${version}-arm64.zip`, `Graft-${version}-x64.zip`]
        : name === "latest.yml"
          ? [`Graft-${version}-x64.exe`]
          : [`Graft-${version}-x86_64.AppImage`];
    if (
      manifest.files.length !== expectedFiles.length ||
      !expectedFiles.every((file) => manifest.files.some((entry) => entry.url === file))
    ) {
      throw new Error(`Unexpected updater payload set in ${name}.`);
    }
    for (const file of manifest.files) {
      const payload = payloads.get(file.url);
      if (
        !payload ||
        !("filePath" in payload.body) ||
        payload.size !== file.size ||
        (await fileDigest(payload.body.filePath, "sha512", "base64")) !== file.sha512
      ) {
        throw new Error(`Invalid updater checksum or size: ${file.url}.`);
      }
    }
    const rewritten = serializeMacUpdateManifest({
      ...manifest,
      files: manifest.files.map((file) => ({ ...file, url: `${version}/${file.url}` })),
    });
    manifests.push(releaseBytes(`releases/${name}`, Buffer.from(rewritten)));
    payloads.set(name, releaseBytes(`${prefix}/${name}`, Buffer.from(rewritten)));
  }
  for (const arch of ["arm64", "x64"]) {
    if (!payloads.has(`Graft-${version}-${arch}.dmg`))
      throw new Error(`Missing macOS ${arch} installer.`);
  }
  payloads.set(
    "upgrade-evidence.json",
    releaseBytes(
      `${prefix}/upgrade-evidence.json`,
      Buffer.from(JSON.stringify(evidence, null, 2) + "\n"),
    ),
  );
  const releaseIndex = {
    schemaVersion: 1,
    version,
    sourceCommit,
    lockfileSha256: provenances[0]!.source.lockfileSha256,
    artifacts: [...payloads.values()].map(({ pathname, sha256, size }) => ({
      pathname,
      sha256,
      size,
    })),
  };
  payloads.set(
    "release.json",
    releaseBytes(
      `${prefix}/release.json`,
      Buffer.from(JSON.stringify(releaseIndex, null, 2) + "\n"),
    ),
  );
  return { version, sourceCommit, prefix, payloads: [...payloads.values()], manifests, evidence };
}

async function ensureImmutable(store: ReleaseStore, object: ReleaseObject): Promise<void> {
  if (await store.verify(object)) return;
  await store.put(object, false);
  if (!(await store.verify(object)))
    throw new Error(`Uploaded object is not readable: ${object.pathname}.`);
}

/** Objects are immutable; each stable YAML is overwritten only after every payload is verified. */
export async function publishGraftRelease(
  plan: GraftReleasePlan,
  store: ReleaseStore,
): Promise<void> {
  const previous = new Map<string, Uint8Array>();
  for (const manifest of plan.manifests) {
    const bytes = await store.read(manifest.pathname);
    if (!bytes) throw new Error(`Existing stable feed missing: ${manifest.pathname}.`);
    const old = parseMacUpdateManifest(Buffer.from(bytes).toString(), manifest.pathname);
    const name = basename(manifest.pathname) as (typeof STABLE_MANIFESTS)[number];
    if (old.version === plan.evidence.previousVersions[name]) {
      previous.set(manifest.pathname, bytes);
    } else if (sha256(bytes) === manifest.sha256) {
      // A retry can resume an interrupted promotion only if the published pointer
      // already matches these exact candidate bytes and the original snapshot survives.
      const snapshot = await store.read(`${plan.prefix}/rollback/${name}`);
      if (
        !snapshot ||
        parseMacUpdateManifest(Buffer.from(snapshot).toString(), name).version !==
          plan.evidence.previousVersions[name]
      ) {
        throw new Error(`Missing original rollback snapshot for partially promoted ${name}.`);
      }
      previous.set(manifest.pathname, snapshot);
    } else {
      throw new Error(`Stable feed changed since upgrade testing: ${name} is ${old.version}.`);
    }
  }
  // Snapshot every original pointer before changing any stable pointer. No deletion/pruning.
  for (const [pathname, bytes] of previous) {
    await ensureImmutable(
      store,
      releaseBytes(`${plan.prefix}/rollback/${basename(pathname)}`, bytes),
    );
  }
  for (const payload of plan.payloads) await ensureImmutable(store, payload);
  for (const [pathname, bytes] of previous) {
    const current = await store.read(pathname);
    const candidate = plan.manifests.find((entry) => entry.pathname === pathname)!;
    if (!current || (sha256(current) !== sha256(bytes) && sha256(current) !== candidate.sha256)) {
      throw new Error(`Stable feed changed during upload: ${pathname}.`);
    }
  }
  // Vercel Blob replaces one object atomically; there is no cross-object transaction.
  // A partial promotion still serves complete, verified old/new releases per OS.
  for (const manifest of plan.manifests) {
    const current = await store.read(manifest.pathname);
    if (current && sha256(current) === manifest.sha256) continue;
    await store.put(manifest, true);
    if (!(await store.verify(manifest)))
      throw new Error(
        `Stable manifest readback failed: ${manifest.pathname}. Rollback snapshots are in ${plan.prefix}/rollback/.`,
      );
  }
}
