import { describe, expect, it } from "vitest";

import { applyMinimumSystemVersionToUpdateManifest } from "./update-manifest-system-version.ts";

const MANIFEST = `version: 0.9.0
files:
  - url: Graft-0.9.0-x64.exe
    sha512: abc
    size: 123
path: Graft-0.9.0-x64.exe
sha512: abc
releaseDate: '2026-09-17T00:00:00.000Z'
`;

describe("applyMinimumSystemVersionToUpdateManifest", () => {
  it("adds the updater OS gate before releaseDate", () => {
    expect(
      applyMinimumSystemVersionToUpdateManifest({
        raw: MANIFEST,
        sourcePath: "latest.yml",
        minimumSystemVersion: "10.0.0",
      }),
    ).toContain("minimumSystemVersion: 10.0.0\nreleaseDate:");
  });

  it("replaces an existing updater OS gate without duplicating it", () => {
    const updated = applyMinimumSystemVersionToUpdateManifest({
      raw: MANIFEST.replace("releaseDate:", "minimumSystemVersion: 11.0.0\nreleaseDate:"),
      sourcePath: "latest-mac.yml",
      minimumSystemVersion: "21.4.0",
    });

    expect(updated.match(/^minimumSystemVersion:/gm)).toHaveLength(1);
    expect(updated).toContain("minimumSystemVersion: 21.4.0");
  });

  it("rejects malformed manifests instead of emitting an unguarded update", () => {
    expect(() =>
      applyMinimumSystemVersionToUpdateManifest({
        raw: "version: 0.9.0\n",
        sourcePath: "latest.yml",
        minimumSystemVersion: "10.0.0",
      }),
    ).toThrow("missing releaseDate");
  });
});
