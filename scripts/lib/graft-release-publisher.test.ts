import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MAC_MINIMUM_DARWIN_VERSION } from "./desktop-platform-build-config.ts";
import {
  prepareGraftRelease,
  publishGraftRelease,
  releaseBytes,
  RELEASE_PLATFORMS,
  STABLE_MANIFESTS,
  UPGRADE_CHECKS,
  type ReleaseObject,
  type ReleaseStore,
  type UpgradeEvidence,
} from "./graft-release-publisher.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const version = "0.9.1";
const previousVersion = "0.9.0";
const sourceCommit = "a".repeat(40);

async function fixture(releaseVersion = version, predecessorVersion = previousVersion) {
  const directory = await mkdtemp(join(tmpdir(), "graft-publish-test-"));
  directories.push(directory);
  const receipts: UpgradeEvidence["platforms"][number][] = [];
  for (const key of RELEASE_PLATFORMS) {
    const [platform, arch] = key.split("-");
    const extensions =
      platform === "mac" ? ["zip", "dmg"] : platform === "win" ? ["exe"] : ["AppImage"];
    const artifacts: { fileName: string; sha256: string; size: number }[] = [];
    for (const ext of extensions) {
      const name = `Graft-${releaseVersion}-${platform === "linux" ? "x86_64" : arch}.${ext}`;
      const bytes = Buffer.from(`native ${name}`);
      await writeFile(join(directory, name), bytes);
      artifacts.push({ fileName: name, sha256: hash(bytes), size: bytes.length });
    }
    const update = artifacts[0]!;
    const bytes = await readFile(join(directory, update.fileName));
    const manifestName =
      platform === "mac"
        ? arch === "arm64"
          ? "latest-mac.yml"
          : "latest-mac-x64.yml"
        : platform === "win"
          ? "latest.yml"
          : "latest-linux.yml";
    const manifestBytes = Buffer.from(
      `version: ${releaseVersion}\nfiles:\n  - url: ${update.fileName}\n    sha512: ${createHash("sha512").update(bytes).digest("base64")}\n    size: ${bytes.length}\n${platform === "linux" ? "    blockMapSize: 12\n" : ""}path: ${update.fileName}\nsha512: ignored-legacy-top-level\n${platform === "mac" ? `minimumSystemVersion: ${MAC_MINIMUM_DARWIN_VERSION}\n` : platform === "win" ? "minimumSystemVersion: 10.0.0\n" : ""}releaseDate: '2026-09-16T00:00:00.000Z'\n`,
    );
    await writeFile(join(directory, manifestName), manifestBytes);
    artifacts.push({
      fileName: manifestName,
      sha256: hash(manifestBytes),
      size: manifestBytes.length,
    });
    const signing =
      platform === "mac"
        ? {
            status: "verified",
            scheme: "apple-developer-id",
            identity: { teamId: "LEGACYTEAM" },
            checks: ["codesign", "spctl"],
          }
        : platform === "win"
          ? {
              status: "verified",
              scheme: "windows-authenticode",
              identity: [],
              checks: ["authenticode"],
            }
          : { status: "not-applicable", scheme: "none", identity: null, checks: [] };
    await writeFile(
      join(directory, `artifact-${key}.provenance.json`),
      JSON.stringify({
        schemaVersion: 1,
        version: releaseVersion,
        platform,
        arch,
        target: extensions[0],
        publication: false,
        source: { commit: sourceCommit, lockfileSha256: "b".repeat(64), tag: null },
        signing,
        artifacts,
      }),
    );
    const initialCutover = releaseVersion === "0.9.0" && predecessorVersion === "0.1.143";
    const noLegacyRelease = initialCutover && key === "mac-x64";
    receipts.push({
      platform: key,
      artifact: update.fileName,
      sha256: update.sha256,
      evidenceUrl: `https://github.com/brentmwarner/graft-studio/actions/runs/123#${key}`,
      previousArtifact: noLegacyRelease
        ? null
        : initialCutover
          ? key === "mac-arm64"
            ? "Graft-0.1.143-arm64-mac.zip"
            : key === "win-x64"
              ? "Graft-Setup-x64.exe"
              : "Graft-x64.AppImage"
          : key === "mac-arm64"
            ? `Graft-${predecessorVersion}-arm64.zip`
            : key === "mac-x64"
              ? `Graft-${predecessorVersion}-x64.zip`
              : key === "win-x64"
                ? `Graft-${predecessorVersion}-x64.exe`
                : `Graft-${predecessorVersion}-x86_64.AppImage`,
      checks: Object.fromEntries(
        UPGRADE_CHECKS.map((check) => [
          check,
          noLegacyRelease && (check === "legacy-update" || check === "rollback")
            ? "not-applicable-no-legacy-release"
            : "passed",
        ]),
      ) as UpgradeEvidence["platforms"][number]["checks"],
    });
  }
  const evidence: UpgradeEvidence = {
    schemaVersion: 2,
    version: releaseVersion,
    sourceCommit,
    previousVersions: {
      "latest-mac.yml": predecessorVersion,
      "latest.yml": predecessorVersion,
      "latest-linux.yml": predecessorVersion,
    },
    platforms: receipts,
  };
  return { directory, evidence };
}

class MemoryStore implements ReleaseStore {
  objects = new Map<string, Uint8Array>();
  operations: string[] = [];
  failAt: string | null = null;
  constructor() {
    for (const name of STABLE_MANIFESTS)
      this.objects.set(
        `releases/${name}`,
        Buffer.from(
          `version: ${previousVersion}\nfiles:\n  - url: legacy.zip\n    sha512: old\n    size: 3\nreleaseDate: '2026-01-01'\n`,
        ),
      );
  }
  async read(pathname: string) {
    return this.objects.get(pathname) ?? null;
  }
  async verify(object: ReleaseObject) {
    this.operations.push(`verify:${object.pathname}`);
    const bytes = this.objects.get(object.pathname);
    if (!bytes) return false;
    if (bytes.byteLength !== object.size || hash(bytes) !== object.sha256)
      throw new Error("checksum mismatch");
    return true;
  }
  async put(object: ReleaseObject, overwrite: boolean) {
    this.operations.push(`put:${overwrite}:${object.pathname}`);
    if (object.pathname === this.failAt) throw new Error("upload failed");
    if (!overwrite && this.objects.has(object.pathname)) throw new Error("immutable object exists");
    this.objects.set(
      object.pathname,
      "filePath" in object.body ? await readFile(object.body.filePath) : object.body.bytes,
    );
  }
}

describe("Graft production feed", () => {
  it("verifies four native builds and preserves versioned mac architectures", async () => {
    const { directory, evidence } = await fixture();
    const plan = await prepareGraftRelease(directory, evidence);
    expect(plan.manifests.map((entry) => basename(entry.pathname))).toEqual(STABLE_MANIFESTS);
    const mac = plan.manifests[0]!;
    expect("bytes" in mac.body && Buffer.from(mac.body.bytes).toString()).toContain(
      `url: ${version}/Graft-${version}-arm64.zip`,
    );
    expect("bytes" in mac.body && Buffer.from(mac.body.bytes).toString()).toContain(
      `url: ${version}/Graft-${version}-x64.zip`,
    );
    expect(await readFile(join(directory, "latest-mac.yml"), "utf8")).not.toContain(
      `url: ${version}/`,
    );
  });

  it("snapshots old pointers and verifies every payload before any stable overwrite", async () => {
    const { directory, evidence } = await fixture();
    const plan = await prepareGraftRelease(directory, evidence);
    const store = new MemoryStore();
    await publishGraftRelease(plan, store);
    const firstPromotion = store.operations.findIndex((entry) => entry.startsWith("put:true:"));
    expect(firstPromotion).toBeGreaterThan(0);
    for (const payload of plan.payloads) {
      expect(store.operations.lastIndexOf(`verify:${payload.pathname}`)).toBeLessThan(
        firstPromotion,
      );
    }
    for (const name of STABLE_MANIFESTS) {
      expect(
        Buffer.from(store.objects.get(`releases/${version}/rollback/${name}`)!).toString(),
      ).toContain(`version: ${previousVersion}`);
      expect(Buffer.from(store.objects.get(`releases/${name}`)!).toString()).toContain(
        `version: ${version}`,
      );
    }
  });

  it("never touches the stable feed when upload fails or immutable payload differs", async () => {
    const { directory, evidence } = await fixture();
    const plan = await prepareGraftRelease(directory, evidence);
    for (const corrupt of [false, true]) {
      const store = new MemoryStore();
      if (corrupt) store.objects.set(plan.payloads[0]!.pathname, Buffer.from("corruption"));
      else store.failAt = plan.payloads[0]!.pathname;
      await expect(publishGraftRelease(plan, store)).rejects.toThrow(
        corrupt ? "checksum" : "upload failed",
      );
      expect(store.operations.some((entry) => entry.startsWith("put:true:"))).toBe(false);
    }
  });

  it("accepts the explicit unsigned Windows release provenance", async () => {
    const { directory, evidence } = await fixture();
    const path = join(directory, "artifact-win-x64.provenance.json");
    const provenance = JSON.parse(await readFile(path, "utf8"));
    provenance.signing.status = "unsigned-explicit-release";
    provenance.signing.scheme = "none";
    provenance.signing.identity = null;
    await writeFile(path, JSON.stringify(provenance));
    await expect(prepareGraftRelease(directory, evidence)).resolves.toMatchObject({ version });
  });

  it("rejects an unsigned Windows build without the explicit release exception", async () => {
    const { directory, evidence } = await fixture();
    const path = join(directory, "artifact-win-x64.provenance.json");
    const provenance = JSON.parse(await readFile(path, "utf8"));
    provenance.signing.status = "unsigned-build-only";
    provenance.signing.scheme = "none";
    provenance.signing.identity = null;
    await writeFile(path, JSON.stringify(provenance));
    await expect(prepareGraftRelease(directory, evidence)).rejects.toThrow(
      "verified native signatures",
    );
  });

  it("models the exact cutover when the legacy release had no Intel Mac build", async () => {
    const { directory, evidence } = await fixture("0.9.0", "0.1.143");
    await expect(prepareGraftRelease(directory, evidence)).resolves.toMatchObject({
      version: "0.9.0",
    });

    const stale: UpgradeEvidence = {
      ...evidence,
      previousVersions: { ...evidence.previousVersions, "latest.yml": "0.1.142" },
    };
    await expect(prepareGraftRelease(directory, stale)).rejects.toThrow(
      "Wrong predecessor artifact",
    );
  });

  it("does not reuse the initial Intel Mac exception for a later release", async () => {
    const { directory, evidence } = await fixture("0.9.1", "0.1.143");
    const intel = evidence.platforms.find((entry) => entry.platform === "mac-x64")!;
    const invalid: UpgradeEvidence = {
      ...evidence,
      platforms: evidence.platforms.map((entry) =>
        entry === intel
          ? {
              ...entry,
              previousArtifact: null,
              checks: {
                ...entry.checks,
                "legacy-update": "not-applicable-no-legacy-release",
                rollback: "not-applicable-no-legacy-release",
              },
            }
          : entry,
      ),
    };
    await expect(prepareGraftRelease(directory, invalid)).rejects.toThrow(
      "Wrong predecessor artifact for mac-x64",
    );
  });

  it("binds later evidence to the predecessor artifact naming contract", async () => {
    const { directory, evidence } = await fixture();
    const windows = evidence.platforms.find((entry) => entry.platform === "win-x64")!;
    const invalid: UpgradeEvidence = {
      ...evidence,
      platforms: evidence.platforms.map((entry) =>
        entry === windows ? { ...entry, previousArtifact: "wrong.exe" } : entry,
      ),
    };
    await expect(prepareGraftRelease(directory, invalid)).rejects.toThrow(
      "Wrong predecessor artifact for win-x64",
    );
  });

  it("does not accept inapplicable checks when a legacy artifact exists", async () => {
    const { directory, evidence } = await fixture();
    const windows = evidence.platforms.find((entry) => entry.platform === "win-x64")!;
    const invalid: UpgradeEvidence = {
      ...evidence,
      platforms: evidence.platforms.map((entry) =>
        entry === windows
          ? {
              ...entry,
              checks: {
                ...entry.checks,
                "legacy-update": "not-applicable-no-legacy-release",
              },
            }
          : entry,
      ),
    };
    await expect(prepareGraftRelease(directory, invalid)).rejects.toThrow(
      "win-x64 has no passing legacy-update evidence",
    );
  });

  it("rejects missing native proof, edited bytes, or a non-versioned payload", async () => {
    const { directory, evidence } = await fixture();
    await expect(
      prepareGraftRelease(directory, { ...evidence, platforms: evidence.platforms.slice(1) }),
    ).rejects.toThrow("each native platform");
    const path = join(directory, evidence.platforms[0]!.artifact);
    await writeFile(path, "replacement");
    await expect(prepareGraftRelease(directory, evidence)).rejects.toThrow(
      "differ from native provenance",
    );
  });

  it("refuses stale predecessor evidence before uploading anything", async () => {
    const { directory, evidence } = await fixture();
    const plan = await prepareGraftRelease(directory, evidence);
    const store = new MemoryStore();
    store.objects.set(
      "releases/latest.yml",
      Buffer.from(
        "version: 0.1.144\nfiles:\n  - url: old.exe\n    sha512: old\n    size: 1\nreleaseDate: 'today'\n",
      ),
    );
    await expect(publishGraftRelease(plan, store)).rejects.toThrow("changed since upgrade testing");
    expect(store.operations).toEqual([]);
  });

  it("keeps the remaining old platform manifests usable after a partial promotion", async () => {
    const { directory, evidence } = await fixture();
    const plan = await prepareGraftRelease(directory, evidence);
    const store = new MemoryStore();
    store.failAt = "releases/latest.yml";
    await expect(publishGraftRelease(plan, store)).rejects.toThrow("upload failed");
    expect(Buffer.from(store.objects.get("releases/latest-mac.yml")!).toString()).toContain(
      `version: ${version}`,
    );
    expect(Buffer.from(store.objects.get("releases/latest.yml")!).toString()).toContain(
      `version: ${previousVersion}`,
    );
    expect(store.objects.has(`releases/${version}/rollback/latest-mac.yml`)).toBe(true);
    for (const object of plan.payloads) expect(await store.verify(object)).toBe(true);
    store.failAt = null;
    await publishGraftRelease(plan, store);
    expect(Buffer.from(store.objects.get("releases/latest.yml")!).toString()).toContain(
      `version: ${version}`,
    );
    expect(
      Buffer.from(store.objects.get(`releases/${version}/rollback/latest-mac.yml`)!).toString(),
    ).toContain(`version: ${previousVersion}`);
  });

  it("refuses a release that would offer incompatible binaries to old Macs", async () => {
    const { directory, evidence } = await fixture();
    const manifestPath = join(directory, "latest-mac.yml");
    const bytes = Buffer.from(
      (await readFile(manifestPath, "utf8")).replace(
        `minimumSystemVersion: ${MAC_MINIMUM_DARWIN_VERSION}\n`,
        "",
      ),
    );
    await writeFile(manifestPath, bytes);
    const path = join(directory, "artifact-mac-arm64.provenance.json");
    const provenance = JSON.parse(await readFile(path, "utf8"));
    const entry = provenance.artifacts.find(
      (artifact: { fileName: string }) => artifact.fileName === "latest-mac.yml",
    );
    entry.sha256 = hash(bytes);
    entry.size = bytes.length;
    await writeFile(path, JSON.stringify(provenance));
    // The other architecture still has the gate; remove both to test admission.
    const x64Path = join(directory, "latest-mac-x64.yml");
    const x64Bytes = Buffer.from(
      (await readFile(x64Path, "utf8")).replace(
        `minimumSystemVersion: ${MAC_MINIMUM_DARWIN_VERSION}\n`,
        "",
      ),
    );
    await writeFile(x64Path, x64Bytes);
    const x64ProvenancePath = join(directory, "artifact-mac-x64.provenance.json");
    const x64Provenance = JSON.parse(await readFile(x64ProvenancePath, "utf8"));
    const x64Entry = x64Provenance.artifacts.find(
      (artifact: { fileName: string }) => artifact.fileName === "latest-mac-x64.yml",
    );
    x64Entry.sha256 = hash(x64Bytes);
    x64Entry.size = x64Bytes.length;
    await writeFile(x64ProvenancePath, JSON.stringify(x64Provenance));
    await expect(prepareGraftRelease(directory, evidence)).rejects.toThrow("OS version gate");
  });

  it("hashes metadata bytes exactly", () => {
    const object = releaseBytes("release.json", Buffer.from("{}\n"));
    expect(object.sha256).toBe(hash(Buffer.from("{}\n")));
  });
});
