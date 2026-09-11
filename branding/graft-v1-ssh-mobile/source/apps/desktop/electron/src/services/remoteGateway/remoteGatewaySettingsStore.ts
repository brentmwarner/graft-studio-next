import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Durable, non-secret gateway preferences. `enabled` records user intent so
 * the gateway comes back up after an app relaunch; `preferredPort` pins the
 * listener to the port paired phones already have persisted in their session
 * URLs, so a restart doesn't orphan every paired device.
 */
export type RemoteGatewaySettings = {
  enabled: boolean;
  keepHostAwake: boolean;
  preferredPort: number | null;
};

export type RemoteGatewaySettingsStore = {
  load: () => RemoteGatewaySettings;
  save: (settings: RemoteGatewaySettings) => void;
};

export const DEFAULT_REMOTE_GATEWAY_SETTINGS: RemoteGatewaySettings = {
  enabled: false,
  keepHostAwake: false,
  preferredPort: null,
};

export function createFileRemoteGatewaySettingsStore(
  filePath: string,
): RemoteGatewaySettingsStore {
  return {
    load() {
      try {
        const raw = readFileSync(filePath, "utf8");
        return sanitize(JSON.parse(raw));
      } catch {
        return { ...DEFAULT_REMOTE_GATEWAY_SETTINGS };
      }
    },
    save(settings) {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(sanitize(settings), null, 2));
      } catch {
        // Settings are a convenience cache; losing a write only means the
        // user re-toggles the gateway after the next relaunch.
      }
    },
  };
}

export function createInMemoryRemoteGatewaySettingsStore(
  initial?: Partial<RemoteGatewaySettings>,
): RemoteGatewaySettingsStore {
  let settings: RemoteGatewaySettings = sanitize({
    ...DEFAULT_REMOTE_GATEWAY_SETTINGS,
    ...initial,
  });
  return {
    load: () => ({ ...settings }),
    save(next) {
      settings = sanitize(next);
    },
  };
}

function sanitize(value: unknown): RemoteGatewaySettings {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const preferredPort =
    typeof record.preferredPort === "number" &&
    Number.isInteger(record.preferredPort) &&
    record.preferredPort >= 1 &&
    record.preferredPort <= 65535
      ? record.preferredPort
      : null;
  return {
    enabled: record.enabled === true,
    keepHostAwake: record.keepHostAwake === true,
    preferredPort,
  };
}
