import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GRAFT_HOST_VERSION } from "@graft/desktop-contract";

import { LINUX_X64_GLIBC_PLATFORM } from "./hostPlatform";
import { OccupancyProtocol } from "./occupancyProtocol";
import { OccupancyStore } from "./occupancyStore";

describe("OccupancyProtocol", () => {
  it("exchanges a one-use token for occupancy and welcomes over the desktop profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "graft-occupancy-protocol-"));
    const store = new OccupancyStore(join(root, "graft-host.db"), {
      randomSecret: () => "abcdefghijklmnopqrstuvwxyz012345",
    });
    try {
      const protocol = new OccupancyProtocol(store, {
        environmentLabel: "Omarchy",
        daemonVersion: GRAFT_HOST_VERSION,
        port: 4783,
        platform: LINUX_X64_GLIBC_PLATFORM,
        capabilities: ["projects", "diagnostics"],
        enrollmentGrants: ["projects", "diagnostics"],
        dispatchCommand: async (_session, command) => {
          if (command.type === "project/list") return { projects: [] };
          throw new Error(command.type);
        },
      });
      const bootstrap = protocol.bootstrap();
      expect(bootstrap.enrollmentToken).toHaveLength(32);
      const first = protocol.enroll({
        protocolVersion: 1,
        enrollmentToken: bootstrap.enrollmentToken,
        clientId: "desktop-1",
        clientLabel: "Graft Desktop",
        clientVersion: GRAFT_HOST_VERSION,
        capabilities: ["projects", "diagnostics"],
      });
      expect(first?.session.profile).toBe("desktop_occupancy");
      expect(
        protocol.enroll({
          protocolVersion: 1,
          enrollmentToken: bootstrap.enrollmentToken,
          clientId: "desktop-2",
          clientLabel: "Replay",
          clientVersion: GRAFT_HOST_VERSION,
          capabilities: ["projects"],
        }),
      ).toBeNull();

      const opened = protocol.open(first!.bearer, {
        envelope: "hello",
        protocolVersion: 1,
        clientVersion: GRAFT_HOST_VERSION,
        capabilities: ["projects", "diagnostics"],
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.messages[0]?.envelope).toBe("welcome");

      const listed = await protocol.handle(opened.connection, {
        envelope: "command",
        commandId: "11111111-1111-4111-8111-111111111111",
        command: { version: 1, type: "project/list" },
      });
      expect(listed[0]?.envelope).toBe("response");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
