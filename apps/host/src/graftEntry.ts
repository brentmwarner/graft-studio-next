import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GRAFT_HOST_SERVER_ENTRY } from "@graft/desktop-contract";

export function resolveGraftEntry(
  environment: NodeJS.ProcessEnv = process.env,
  fromUrl: string = import.meta.url,
  exists: (path: string) => boolean = existsSync,
): string {
  const override = environment.GRAFT_HOST_SERVER_BIN?.trim();
  if (override) return override;
  const bundled = fileURLToPath(new URL(`./${GRAFT_HOST_SERVER_ENTRY}`, fromUrl));
  if (exists(bundled)) return bundled;
  return fileURLToPath(new URL("../../server/src/index.ts", fromUrl));
}
