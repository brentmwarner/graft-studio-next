import { describe, expect, it } from "vitest";

import { loadReleaseDownloads } from "./releaseDownloads";

const releases = "https://github.com/brentmwarner/graft-studio-next/releases";

function response(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe("loadReleaseDownloads", () => {
  it("loads every platform from the public GitHub release", async () => {
    const version = "0.9.0";
    const asset = (name: string) => `${releases}/download/v${version}/${name}`;
    const fixtures = new Map([
      [
        `${releases}/latest/download/latest-mac.yml`,
        `version: ${version}\nfiles:\n  - url: ${asset("Graft-0.9.0-arm64.zip")}\n  - url: ${asset("Graft-0.9.0-x64.zip")}\n`,
      ],
      [
        `${releases}/latest/download/latest.yml`,
        `version: ${version}\nfiles:\n  - url: ${asset("Graft-0.9.0-x64.exe")}\n`,
      ],
      [
        `${releases}/latest/download/latest-linux.yml`,
        `version: ${version}\nfiles:\n  - url: ${asset("Graft-0.9.0-x86_64.AppImage")}\n`,
      ],
      [
        `${releases}/download/v${version}/release.json`,
        JSON.stringify({
          version,
          sourceCommit: "a".repeat(40),
          artifacts: ["arm64", "x64"].map((arch) => ({
            pathname: `releases/${version}/Graft-${version}-${arch}.dmg`,
            url: asset(`Graft-${version}-${arch}.dmg`),
          })),
        }),
      ],
    ]);

    const downloads = await loadReleaseDownloads(async (url) => {
      const body = fixtures.get(url);
      return body === undefined ? response("missing", 404) : response(body);
    });

    expect(downloads).toEqual({
      version: "v0.9.0",
      releasesUrl: `${releases}/tag/v0.9.0`,
      mac: {
        arm64: asset("Graft-0.9.0-arm64.dmg"),
        x64: asset("Graft-0.9.0-x64.dmg"),
      },
      windows: asset("Graft-0.9.0-x64.exe"),
      linux: asset("Graft-0.9.0-x86_64.AppImage"),
    });
  });

  it("rejects installer URLs outside the exact public release repository", async () => {
    const maliciousManifest =
      "version: 0.9.0\nfiles:\n  - url: https://github.com/example/graft-studio-next/releases/download/v0.9.0/Graft-0.9.0-x64.exe\n";

    const downloads = await loadReleaseDownloads(async (url) =>
      url.endsWith("latest.yml") ? response(maliciousManifest) : response("missing", 404),
    );

    expect(downloads.windows).toBeNull();
    expect(downloads.version).toBeNull();
  });
});
