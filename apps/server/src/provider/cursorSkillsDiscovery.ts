// FILE: cursorSkillsDiscovery.ts
// Purpose: Finds Cursor-compatible Agent Skill folders from project and user skill roots,
//          mirroring the roots cursor-agent scans natively.
// Layer: Server provider discovery helper
// Exports: discoverCursorSkills (generic primitives live in skillsCatalog.ts).

import type { ProviderSkillDescriptor } from "@synara/contracts";
import { resolveSynaraHomeDirectory } from "@synara/shared/synaraHome";

import { collectSkillsFromRoots, providerNativeSkillRoots } from "./skillsCatalog.ts";

export interface CursorSkillDiscoveryInput {
  readonly cwd: string;
  readonly homeDir: string;
  /** App data root; defaults to the resolved Graft/Synara home. */
  readonly synaraBaseDir?: string;
}

export async function discoverCursorSkills(
  input: CursorSkillDiscoveryInput,
): Promise<ProviderSkillDescriptor[]> {
  return collectSkillsFromRoots(
    providerNativeSkillRoots({
      cwd: input.cwd,
      homeDir: input.homeDir,
      synaraBaseDir:
        input.synaraBaseDir ??
        resolveSynaraHomeDirectory({
          homeDirectory: input.homeDir,
        }),
      provider: "cursor",
    }),
  );
}
