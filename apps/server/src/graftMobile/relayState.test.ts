import { afterEach, expect, it, vi } from "vitest";

import {
  getDesktopRelayEndpoint,
  getDesktopRelayStatus,
  setDesktopRelayStatus,
} from "./relayState";

afterEach(() => vi.useRealTimers());

it("advertises an active relay including its environment path, then expires a stale uplink", () => {
  vi.useFakeTimers();
  setDesktopRelayStatus({
    state: "connected",
    httpBaseUrl: "https://relay.test/e/env-1",
    wsBaseUrl: "wss://relay.test/e/env-1",
    lastError: null,
  });
  expect(getDesktopRelayEndpoint()?.httpBaseUrl).toBe("https://relay.test/e/env-1");
  vi.advanceTimersByTime(30_001);
  expect(getDesktopRelayEndpoint()).toBeNull();
  expect(getDesktopRelayStatus().state).toBe("disabled");
});

it("does not issue relay addresses while reconnecting", () => {
  setDesktopRelayStatus({
    state: "connecting",
    httpBaseUrl: "https://relay.test/e/env-1",
    wsBaseUrl: "wss://relay.test/e/env-1",
    lastError: null,
  });
  expect(getDesktopRelayEndpoint()).toBeNull();
});
