import { describe, expect, it } from "vitest";
import { OccupancyCommandError } from "@graft/occupancy";
import type { OrchestrationShellSnapshot } from "@synara/contracts";

import { dispatchOccupancyCommand } from "./occupancyDispatch";

const shell = {
  snapshotSequence: 1,
  spaces: [],
  projects: [
    {
      id: "project-1",
      kind: "project",
      title: "graft-studio-next",
      workspaceRoot: "/repo",
    },
  ],
  threads: [
    {
      id: "thread-1",
      title: "Wire occupancy",
      projectId: "project-1",
    },
  ],
  updatedAt: new Date().toISOString(),
} as unknown as OrchestrationShellSnapshot;

const session = {
  sessionId: "session-desktop-01",
  environmentId: "environment-1",
  profile: "desktop_occupancy" as const,
  clientId: "desktop-1",
  clientLabel: "Graft",
  grants: ["projects", "threads"] as const,
  createdAt: 1,
  expiresAt: 2,
  lastSeenAt: 1,
  revokedAt: null,
};

describe("occupancy command adapter", () => {
  it("lists projects and threads from the existing orchestration shell", async () => {
    await expect(
      dispatchOccupancyCommand(async () => shell, session, { type: "project/list" }),
    ).resolves.toEqual({
      projects: [
        {
          id: "project-1",
          name: "graft-studio-next",
          kind: "project",
          path: "/repo",
        },
      ],
    });
    await expect(
      dispatchOccupancyCommand(async () => shell, session, { type: "thread/list" }),
    ).resolves.toEqual({
      threads: [{ id: "thread-1", title: "Wire occupancy", projectId: "project-1" }],
    });
  });

  it("rejects unimplemented occupancy commands instead of inventing a second project model", async () => {
    await expect(
      dispatchOccupancyCommand(async () => shell, session, { type: "project/create" }),
    ).rejects.toBeInstanceOf(OccupancyCommandError);
  });
});
