import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OccupancyStore } from "./occupancyStore";

function store() {
  const root = mkdtempSync(join(tmpdir(), "graft-occupancy-"));
  return {
    root,
    occupancy: new OccupancyStore(join(root, "graft-host.db"), {
      now: () => 1_700_000_000_000,
      randomSecret: () => "abcdefghijklmnopqrstuvwxyz012345",
    }),
    close() {
      this.occupancy.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("OccupancyStore", () => {
  it("issues a one-use enrollment token and a desktop_occupancy bearer", () => {
    const fixture = store();
    try {
      const identity = fixture.occupancy.getOrCreateIdentity("Omarchy");
      expect(identity.environmentId.startsWith("host-")).toBe(true);
      const issued = fixture.occupancy.issueEnrollmentToken();
      const enrolled = fixture.occupancy.consumeEnrollmentToken({
        token: issued.token,
        clientId: "desktop-1",
        clientLabel: "Graft Desktop",
        grants: ["projects", "diagnostics"],
      });
      expect(enrolled?.session.profile).toBe("desktop_occupancy");
      expect(enrolled?.bearer).toHaveLength(32);
      expect(
        fixture.occupancy.consumeEnrollmentToken({
          token: issued.token,
          clientId: "desktop-2",
          clientLabel: "Replay",
          grants: ["projects"],
        }),
      ).toBeNull();
      const session = fixture.occupancy.authenticateBearer(enrolled!.bearer);
      expect(session?.sessionId).toBe(enrolled?.session.sessionId);
      expect(fixture.occupancy.authenticateBearer("not-the-bearer-token-value-here-ok")).toBeNull();
    } finally {
      fixture.close();
    }
  });

  it("revokes occupancy bearers so they cannot be reused", () => {
    const fixture = store();
    try {
      fixture.occupancy.getOrCreateIdentity("Omarchy");
      const issued = fixture.occupancy.issueEnrollmentToken();
      const enrolled = fixture.occupancy.consumeEnrollmentToken({
        token: issued.token,
        clientId: "desktop-1",
        clientLabel: "Graft Desktop",
        grants: ["diagnostics"],
      });
      expect(enrolled).not.toBeNull();
      expect(fixture.occupancy.revokeSession(enrolled!.session.sessionId)).toBe(true);
      expect(fixture.occupancy.authenticateBearer(enrolled!.bearer)).toBeNull();
    } finally {
      fixture.close();
    }
  });
});
