import { parse } from "yaml";
import { GRAFT_DESKTOP_UPDATE_URL } from "@graft/shared/desktopIdentity";

export const RELEASES_URL = "https://www.graftapp.io/changelog";
export type ReleaseDownloads = {
  version: string | null;
  releasesUrl: string;
  mac: { arm64: string | null; x64: string | null };
  windows: string | null;
  linux: string | null;
};
type Manifest = { version: string; files: { url: string }[] };
type ReleaseIndex = {
  version: string;
  sourceCommit: string;
  artifacts: { pathname: string; url: string | null }[];
};
export type ReleaseFetch = (url: string) => Promise<Response>;

const GITHUB_RELEASE_ORIGIN = "https://github.com";
const GITHUB_RELEASE_PATH =
  /^\/brentmwarner\/graft-studio\/releases\/download\/v(\d+\.\d+\.\d+)\/(Graft-[A-Za-z0-9._-]+)$/;

export function unavailableDownloads(): ReleaseDownloads {
  return {
    version: null,
    releasesUrl: RELEASES_URL,
    mac: { arm64: null, x64: null },
    windows: null,
    linux: null,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function downloadUrl(path: string, expectedVersion?: string): string | null {
  const feed = new URL(GRAFT_DESKTOP_UPDATE_URL + "/");
  const url = new URL(path, feed);
  const isFeedObject =
    url.origin === feed.origin &&
    url.pathname.startsWith(feed.pathname) &&
    /^\/releases\/[A-Za-z0-9/._-]+$/.test(url.pathname);
  const githubRelease = url.pathname.match(GITHUB_RELEASE_PATH);
  const isGitHubRelease =
    url.origin === GITHUB_RELEASE_ORIGIN &&
    githubRelease !== null &&
    (!expectedVersion || githubRelease[1] === expectedVersion);
  return (isFeedObject || isGitHubRelease) &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
    ? url.href
    : null;
}

async function readManifest(fetchRelease: ReleaseFetch, name: string): Promise<Manifest | null> {
  try {
    const response = await fetchRelease(`${GRAFT_DESKTOP_UPDATE_URL}/${name}`);
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 1_048_576) return null;
    const value: unknown = parse(text, { maxAliasCount: 0 });
    if (
      !object(value) ||
      typeof value.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(value.version) ||
      !Array.isArray(value.files)
    )
      return null;
    const version = value.version;
    const files = value.files.flatMap((file: unknown) => {
      if (!object(file) || typeof file.url !== "string") return [];
      const url = downloadUrl(file.url, version);
      return url ? [{ url }] : [];
    });
    return files.length ? { version, files } : null;
  } catch {
    return null;
  }
}

async function readIndex(
  fetchRelease: ReleaseFetch,
  version: string,
): Promise<ReleaseIndex | null> {
  try {
    const response = await fetchRelease(`${GRAFT_DESKTOP_UPDATE_URL}/${version}/release.json`);
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 1_048_576) return null;
    const value: unknown = JSON.parse(text);
    if (
      !object(value) ||
      value.version !== version ||
      typeof value.sourceCommit !== "string" ||
      !/^[a-f0-9]{40}$/.test(value.sourceCommit) ||
      !Array.isArray(value.artifacts)
    )
      return null;
    const artifacts = value.artifacts.flatMap((entry: unknown) => {
      if (
        !object(entry) ||
        typeof entry.pathname !== "string" ||
        !entry.pathname.startsWith(`releases/${version}/`)
      )
        return [];
      const url = typeof entry.url === "string" ? downloadUrl(entry.url, version) : null;
      return [{ pathname: entry.pathname, url }];
    });
    return { version, sourceCommit: value.sourceCommit, artifacts };
  } catch {
    return null;
  }
}

/** Each OS follows its own promoted pointer, including during a partial rollout. */
export async function loadReleaseDownloads(fetchRelease: ReleaseFetch): Promise<ReleaseDownloads> {
  const [mac, windows, linux] = await Promise.all([
    readManifest(fetchRelease, "latest-mac.yml"),
    readManifest(fetchRelease, "latest.yml"),
    readManifest(fetchRelease, "latest-linux.yml"),
  ]);
  const downloads = unavailableDownloads();
  const versions = [mac?.version, windows?.version, linux?.version];
  if (versions.every((version) => version && version === versions[0]))
    downloads.version = `v${versions[0]}`;
  downloads.windows = windows?.files.find((file) => /\.exe$/i.test(file.url))?.url ?? null;
  downloads.linux = linux?.files.find((file) => /\.AppImage$/i.test(file.url))?.url ?? null;
  if (mac) {
    // Legacy manifests include DMGs. Current updater manifests contain ZIPs only;
    // their immutable release index lists the separately verified DMG installers.
    const index = await readIndex(fetchRelease, mac.version);
    for (const arch of ["arm64", "x64"] as const) {
      downloads.mac[arch] =
        mac.files.find((file) => file.url.endsWith(`-${arch}.dmg`))?.url ?? null;
      if (!downloads.mac[arch] && index) {
        const artifact = index.artifacts.find(
          (entry) => entry.pathname === `releases/${mac.version}/Graft-${mac.version}-${arch}.dmg`,
        );
        if (artifact)
          downloads.mac[arch] = artifact.url ?? downloadUrl(`/${artifact.pathname}`, mac.version);
      }
    }
    if (index) downloads.releasesUrl = `${GRAFT_DESKTOP_UPDATE_URL}/${mac.version}/release.json`;
  }
  return downloads;
}
