// Download links follow the same stable Blob pointers as installed Graft apps.
import "server-only";

import storedLatestReleaseDownloads from "@/data/latest-release-downloads.json";
import { loadReleaseDownloads, type ReleaseDownloads } from "./releaseDownloads";

export { RELEASES_URL, type ReleaseDownloads } from "./releaseDownloads";

export async function getReleaseDownloads(): Promise<ReleaseDownloads> {
  if (process.env.VISUAL_TEST === "1") return storedLatestReleaseDownloads;
  return loadReleaseDownloads((url) =>
    fetch(url, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    }),
  );
}
