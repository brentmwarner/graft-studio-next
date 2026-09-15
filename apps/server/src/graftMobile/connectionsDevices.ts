import { DateTime } from "effect";
import type { AuthClientSession } from "@graft/contracts";

export type ConnectionsDevicePlatform = "ios" | "android" | "web" | "desktop";

export type ConnectionsDevice = {
  deviceId: string;
  sessionId: string;
  label: string;
  platform: ConnectionsDevicePlatform;
  appVersion: string;
  environmentLabel: string;
  lastSeenAt: number;
  connected: boolean;
};

export function connectionsDevicesFromSessions(
  sessions: readonly AuthClientSession[],
  environmentLabel: string,
): ConnectionsDevice[] {
  return sessions
    .filter((session) => session.role === "client")
    .map((session) => ({
      deviceId: session.sessionId,
      sessionId: session.sessionId,
      label: session.client.label?.trim() || "Graft Mobile",
      platform: platformFromSession(session),
      appVersion: "",
      environmentLabel,
      lastSeenAt: epochMillis(session.lastConnectedAt ?? session.issuedAt),
      connected: session.connected,
    }));
}

function platformFromSession(session: AuthClientSession): ConnectionsDevicePlatform {
  const os = session.client.os?.trim().toLowerCase();
  if (os === "ios") return "ios";
  if (os === "android") return "android";
  if (session.client.deviceType === "mobile") return "android";
  if (session.client.deviceType === "desktop") return "desktop";
  return "web";
}

function epochMillis(value: DateTime.Utc): number {
  return DateTime.toEpochMillis(value);
}
