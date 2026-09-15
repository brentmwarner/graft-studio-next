import { AuthSessionId } from "@graft/contracts";
import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { connectionsDevicesFromSessions } from "./connectionsDevices";

describe("connections devices", () => {
  it("maps client sessions onto the pairing panel device list", () => {
    const issuedAt = DateTime.toUtc(Effect.runSync(DateTime.now));
    const devices = connectionsDevicesFromSessions(
      [
        {
          sessionId: AuthSessionId.makeUnsafe("sess-iphone"),
          subject: "phone",
          role: "client",
          method: "bearer-session-token",
          client: {
            label: "Brent's iPhone",
            deviceType: "mobile",
            os: "iOS",
          },
          issuedAt,
          expiresAt: issuedAt,
          lastConnectedAt: issuedAt,
          connected: true,
          current: false,
        },
        {
          sessionId: AuthSessionId.makeUnsafe("sess-owner"),
          subject: "owner",
          role: "owner",
          method: "bearer-session-token",
          client: { deviceType: "desktop" },
          issuedAt,
          expiresAt: issuedAt,
          lastConnectedAt: null,
          connected: true,
          current: true,
        },
      ],
      "Studio Linux",
    );

    expect(devices).toEqual([
      {
        deviceId: "sess-iphone",
        sessionId: "sess-iphone",
        label: "Brent's iPhone",
        platform: "ios",
        appVersion: "",
        environmentLabel: "Studio Linux",
        lastSeenAt: DateTime.toEpochMillis(issuedAt),
        connected: true,
      },
    ]);
  });
});
