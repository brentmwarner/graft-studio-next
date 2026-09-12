import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadMobileGatewaySettings,
  mobileGatewaySettingsPath,
  saveMobileGatewaySettings,
  sanitizeMobileGatewaySettings,
} from "./mobileGatewaySettings";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("mobile gateway settings", () => {
  it("treats missing or invalid files as disabled", () => {
    expect(sanitizeMobileGatewaySettings(null)).toEqual({
      enabled: false,
      preferredPort: null,
    });
    expect(sanitizeMobileGatewaySettings({ enabled: "yes", preferredPort: 12.5 })).toEqual({
      enabled: false,
      preferredPort: null,
    });
  });

  it("round-trips enabled intent and a preferred port", () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-mobile-gateway-"));
    dirs.push(dir);
    const filePath = mobileGatewaySettingsPath(dir);
    saveMobileGatewaySettings(filePath, { enabled: true, preferredPort: 42971 });
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({
      enabled: true,
      preferredPort: 42971,
    });
    expect(loadMobileGatewaySettings(filePath)).toEqual({
      enabled: true,
      preferredPort: 42971,
    });
  });
});
