import { readFileSync } from "node:fs";
import { Effect } from "effect";

import { writeFileStringAtomically } from "../atomicWrite";

export type MobileGatewaySettings = {
  enabled: boolean;
  preferredPort: number | null;
};

export const DEFAULT_MOBILE_GATEWAY_SETTINGS: MobileGatewaySettings = {
  enabled: false,
  preferredPort: null,
};

export function mobileGatewaySettingsPath(stateDir: string): string {
  return `${stateDir}/mobile-gateway.json`;
}

export function loadMobileGatewaySettings(filePath: string): MobileGatewaySettings {
  try {
    return sanitizeMobileGatewaySettings(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return { ...DEFAULT_MOBILE_GATEWAY_SETTINGS };
  }
}

export async function saveMobileGatewaySettings(
  filePath: string,
  settings: MobileGatewaySettings,
): Promise<void> {
  await Effect.runPromise(
    writeFileStringAtomically({
      filePath,
      contents: `${JSON.stringify(sanitizeMobileGatewaySettings(settings), null, 2)}\n`,
    }),
  );
}

export function sanitizeMobileGatewaySettings(value: unknown): MobileGatewaySettings {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const preferredPort =
    typeof record.preferredPort === "number" &&
    Number.isInteger(record.preferredPort) &&
    record.preferredPort >= 1 &&
    record.preferredPort <= 65535
      ? record.preferredPort
      : null;
  return {
    enabled: record.enabled === true,
    preferredPort,
  };
}
