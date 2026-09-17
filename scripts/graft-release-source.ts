#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

const version = process.env.RELEASE_VERSION ?? "";
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("A stable X.Y.Z release version is required.");
if (
  !/^[a-f0-9]{40}$/.test(process.env.EXPECTED_COMMIT ?? "") ||
  process.env.EXPECTED_COMMIT !== commit
) {
  throw new Error("Checkout must match the requested full source commit.");
}
const metadata = JSON.parse(readFileSync("apps/desktop/package.json", "utf8")) as {
  version: string;
};
if (metadata.version !== version)
  throw new Error("Release version must match committed desktop package version.");
const lockfile = createHash("sha256").update(readFileSync("bun.lock")).digest("hex");
if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required.");
appendFileSync(
  process.env.GITHUB_OUTPUT,
  `commit=${commit}\nversion=${version}\nlockfile=${lockfile}\n`,
);
console.log(`Release source: ${commit}, version ${version}, lockfile ${lockfile}.`);
