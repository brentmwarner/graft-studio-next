import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadMobileGatewaySettings,
  mobileGatewaySettingsPath,
  saveMobileGatewaySettings,
  sanitizeMobileGatewaySettings,
} from "./mobileGatewaySettings";

const dirs: string[] = [];

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("round-trips enabled intent and a preferred port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-mobile-gateway-"));
    dirs.push(dir);
    const filePath = mobileGatewaySettingsPath(dir);
    await saveMobileGatewaySettings(filePath, { enabled: true, preferredPort: 42971 });
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({
      enabled: true,
      preferredPort: 42971,
    });
    expect(loadMobileGatewaySettings(filePath)).toEqual({
      enabled: true,
      preferredPort: 42971,
    });
  });

  it("reports a failed save instead of pretending connections will survive relaunch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-mobile-gateway-"));
    dirs.push(dir);
    const parent = join(dir, "not-a-directory");
    writeFileSync(parent, "occupied");
    await expect(async () => {
      await saveMobileGatewaySettings(mobileGatewaySettingsPath(parent), {
        enabled: true,
        preferredPort: 42971,
      });
    }).rejects.toThrow();
  });

  it("preserves the saved port and enabled intent when replacement fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-mobile-gateway-"));
    dirs.push(dir);
    const filePath = mobileGatewaySettingsPath(dir);
    const saved = { enabled: true, preferredPort: 42971 };
    await saveMobileGatewaySettings(filePath, saved);
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(async () => {
      await saveMobileGatewaySettings(filePath, { enabled: false, preferredPort: 5000 });
    }).rejects.toThrow();
    expect(loadMobileGatewaySettings(filePath)).toEqual(saved);
  });
});
