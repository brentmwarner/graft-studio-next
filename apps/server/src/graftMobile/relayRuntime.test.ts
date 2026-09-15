import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraftAccountLoginServiceDependencies } from "./graftAccountLoginService";
import type { RelayStatus } from "./relayUplink";
import {
  connectMobileRelayAccount,
  getMobileRelayEndpoint,
  getMobileRelayStatus,
  initializeMobileRelay,
  parseMobileRelayCredential,
  setMobileRelayEnabled,
  stopMobileRelay,
  waitForMobileRelayPairing,
} from "./relayRuntime";

const mocks = vi.hoisted(() => ({
  uplinks: [] as Array<{
    options: { onStatus: (status: RelayStatus) => void };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
  login: null as GraftAccountLoginServiceDependencies | null,
}));
vi.mock("./relayUplink", () => ({
  createRelayUplink: (options: { onStatus: (status: RelayStatus) => void }) => {
    const client = {
      options,
      start: vi.fn(() => options.onStatus({ state: "connecting", lastError: null })),
      stop: vi.fn(() => options.onStatus({ state: "disabled", lastError: null })),
    };
    mocks.uplinks.push(client);
    return client;
  },
}));
vi.mock("./graftAccountLoginService", () => ({
  GraftAccountLoginService: class {
    constructor(options: GraftAccountLoginServiceDependencies) {
      mocks.login = options;
    }
    async start() {
      return { ok: true };
    }
    async cancel() {}
    async dispose() {}
  },
}));

const credential = {
  environmentId: "computer-1",
  uplinkSecret: "uplink-secret-for-tests",
  httpBaseUrl: "https://relay.example/e/computer-1",
  wsBaseUrl: "wss://relay.example/e/computer-1",
  uplinkUrl: "wss://relay.example/relay/v1/uplink",
};
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "graft-relay-test-"));
  mocks.uplinks.length = 0;
  mocks.login = null;
});
afterEach(() => {
  stopMobileRelay();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

function initializeSaved() {
  writeFileSync(join(directory, "mobile-relay.json"), JSON.stringify(credential));
  initializeMobileRelay(5000, directory, {});
}

describe("mobile relay lifecycle", () => {
  it("starts only after connections are enabled and advertises the authenticated relay", () => {
    initializeSaved();
    expect(mocks.uplinks[0]!.start).not.toHaveBeenCalled();
    expect(getMobileRelayEndpoint()).toBeNull();
    setMobileRelayEnabled(true);
    expect(mocks.uplinks[0]!.start).toHaveBeenCalledOnce();
    mocks.uplinks[0]!.options.onStatus({ state: "connected", lastError: null });
    expect(getMobileRelayEndpoint()).toMatchObject({
      kind: "relay",
      httpBaseUrl: credential.httpBaseUrl,
    });
    setMobileRelayEnabled(false);
    expect(getMobileRelayEndpoint()).toBeNull();
    setMobileRelayEnabled(true);
    mocks.uplinks[0]!.options.onStatus({ state: "connected", lastError: null });
    expect(getMobileRelayEndpoint()?.httpBaseUrl).toBe(credential.httpBaseUrl);
  });

  it("fails pairing during an outage instead of silently saving a LAN address", async () => {
    vi.useFakeTimers();
    initializeSaved();
    setMobileRelayEnabled(true);
    const pairing = expect(waitForMobileRelayPairing()).rejects.toThrow("reconnecting");
    await vi.advanceTimersByTimeAsync(10_000);
    await pairing;
    expect(getMobileRelayEndpoint()).toBeNull();
  });

  it("resumes pairing once the relay recovers", async () => {
    vi.useFakeTimers();
    initializeSaved();
    setMobileRelayEnabled(true);
    const pairing = waitForMobileRelayPairing();
    mocks.uplinks[0]!.options.onStatus({ state: "connected", lastError: null });
    await vi.advanceTimersByTimeAsync(50);
    await expect(pairing).resolves.toBeUndefined();
  });

  it("stores only the scoped relay credential and restores it after restart", async () => {
    initializeMobileRelay(5000, directory, {});
    setMobileRelayEnabled(true);
    await connectMobileRelayAccount("My computer");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(credential), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await mocks.login!.persistToken("private-account-token");
    const saved = readFileSync(join(directory, "mobile-relay.json"), "utf8");
    expect(JSON.parse(saved)).toEqual(credential);
    expect(saved).not.toContain("private-account-token");
    expect(statSync(join(directory, "mobile-relay.json")).mode & 0o777).toBe(0o600);
    expect(fetchMock.mock.calls[0]).toBeDefined();
    stopMobileRelay();
    initializeMobileRelay(5001, directory, {});
    setMobileRelayEnabled(true);
    mocks.uplinks.at(-1)!.options.onStatus({ state: "connected", lastError: null });
    expect(getMobileRelayEndpoint()?.httpBaseUrl).toBe(credential.httpBaseUrl);
  });

  it("does not resurrect or save a login cancelled while registration is in flight", async () => {
    initializeMobileRelay(5000, directory, {});
    setMobileRelayEnabled(true);
    await connectMobileRelayAccount("My computer");
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const registration = mocks.login!.persistToken("account-token");
    setMobileRelayEnabled(false);
    finish(new Response(JSON.stringify(credential)));
    await expect(registration).rejects.toThrow("cancelled");
    expect(() => readFileSync(join(directory, "mobile-relay.json"))).toThrow();
    expect(getMobileRelayStatus().state).toBe("disabled");
    expect(mocks.uplinks).toHaveLength(0);
  });

  it("prefers the current credential over the legacy import", () => {
    writeFileSync(join(directory, "mobile-relay.json"), JSON.stringify(credential));
    initializeMobileRelay(5000, directory, { GRAFT_LEGACY_RELAY_CREDENTIAL: "invalid-legacy" });
    expect(mocks.uplinks).toHaveLength(1);
    expect(getMobileRelayStatus().state).toBe("disabled");
  });

  it("reports malformed credentials without leaking their contents", () => {
    initializeMobileRelay(5000, directory, {
      GRAFT_RELAY_CREDENTIAL: "private-invalid-credential",
    });
    setMobileRelayEnabled(true);
    expect(getMobileRelayStatus().state).toBe("error");
    expect(JSON.stringify(getMobileRelayStatus())).not.toContain("private-invalid");
    expect(mocks.uplinks).toHaveLength(0);
  });

  it.each([
    { httpBaseUrl: "http://relay.example/e/computer-1" },
    { wsBaseUrl: "wss://another.example/e/computer-1" },
    { uplinkUrl: "ws://relay.example/relay/v1/uplink" },
    { uplinkUrl: "wss://secret@relay.example/relay/v1/uplink" },
    { httpBaseUrl: "https://relay.example/e/other-computer" },
  ])("rejects unsafe or mismatched relay addresses %j", (override) => {
    expect(() =>
      parseMobileRelayCredential(JSON.stringify({ ...credential, ...override })),
    ).toThrow();
  });
});
