#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";

import { put } from "@vercel/blob";
import { GRAFT_DESKTOP_UPDATE_URL } from "@graft/shared/desktopIdentity";

import {
  prepareGraftRelease,
  publishGraftRelease,
  type ReleaseObject,
  type ReleaseStore,
  type UpgradeEvidence,
} from "./lib/graft-release-publisher.ts";

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
      "Usage: node scripts/publish-graft-release.ts --assets-dir DIR --evidence FILE [--publish]",
    );
  }
  options.set(arg, process.argv[++index]!);
}
const assetsDirectory = options.get("--assets-dir");
const evidencePath = options.get("--evidence");
if (!assetsDirectory || !evidencePath)
  throw new Error("Both --assets-dir and --evidence are required.");
const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as UpgradeEvidence;
const plan = await prepareGraftRelease(assetsDirectory, evidence);
console.log(
  `Validated ${plan.version} (${plan.sourceCommit}), four native platforms, ${plan.payloads.length} immutable objects.`,
);
if (publish) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token)
    throw new Error(
      "Publication requires BLOB_READ_WRITE_TOKEN for the existing Graft Blob store.",
    );
  const feed = new URL(GRAFT_DESKTOP_UPDATE_URL);
  const request = async (pathname: string) => {
    const url = new URL(pathname, feed.origin);
    // Cache bust the stable pointers and verify actual bytes after overwrite.
    url.searchParams.set("graft_release_verify", randomUUID());
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Release readback failed (${response.status}): ${pathname}.`);
    return response;
  };
  const store: ReleaseStore = {
    async read(pathname) {
      const response = await request(pathname);
      if (!response) return null;
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`Empty release response: ${pathname}.`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_048_576) {
          await reader.cancel();
          throw new Error(`Release metadata exceeds 1 MiB: ${pathname}.`);
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    },
    async verify(object: ReleaseObject) {
      const response = await request(object.pathname);
      if (!response) return false;
      if (!response.body) throw new Error(`Empty release readback: ${object.pathname}.`);
      const hash = createHash("sha256");
      let size = 0;
      for await (const bytes of response.body) {
        size += bytes.byteLength;
        if (size > object.size) throw new Error(`Release object grew: ${object.pathname}.`);
        hash.update(bytes);
      }
      if (size !== object.size || hash.digest("hex") !== object.sha256)
        throw new Error(`Release checksum mismatch: ${object.pathname}.`);
      return true;
    },
    async put(object, overwrite) {
      const result = await put(
        object.pathname,
        "filePath" in object.body
          ? createReadStream(object.body.filePath)
          : Buffer.from(object.body.bytes),
        {
          token,
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: overwrite,
          cacheControlMaxAge: overwrite ? 60 : 31_536_000,
          contentType: object.pathname.endsWith(".yml")
            ? "application/yaml"
            : object.pathname.endsWith(".json")
              ? "application/json"
              : "application/octet-stream",
        },
      );
      const uploaded = new URL(result.url);
      if (uploaded.origin !== feed.origin || uploaded.pathname !== `/${object.pathname}`) {
        throw new Error(
          "Blob token points to a different store or returned an unexpected object path. Stable feed was not promoted.",
        );
      }
    },
  };
  await publishGraftRelease(plan, store);
  console.log(
    `Published ${plan.version}. Previous feed snapshots: ${GRAFT_DESKTOP_UPDATE_URL}/${plan.version}/rollback/.`,
  );
} else {
  console.log("Validation only. No objects or stable update manifests were uploaded.");
}
