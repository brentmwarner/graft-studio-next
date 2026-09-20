import { expect, it, vi } from "vitest";
import { GatewayError } from "../api/gateway";
import { GatewaySocketError } from "../api/gatewaySocket";
import { isOfflineError } from "./connectionStatus";

vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "command-id" }));

it("treats unavailable transports as quiet while preserving actual rejection errors", () => {
  for (const code of ["not_connected", "socket_closed", "host_offline", "timeout"]) {
    expect(isOfflineError(new GatewaySocketError("Unavailable", code))).toBe(true);
  }
  expect(isOfflineError(new GatewayError("Sleeping", "host_offline"))).toBe(true);
  expect(isOfflineError(new GatewayError("No route", "network"))).toBe(true);
  for (const code of [
    "authentication_required",
    "invalid_response",
    "authorization_denied",
  ] as const) {
    expect(isOfflineError(new GatewaySocketError("Rejected", code))).toBe(false);
    expect(isOfflineError(new GatewayError("Rejected", code))).toBe(false);
  }
  expect(isOfflineError(new GatewaySocketError("Rejected", "command_rejected"))).toBe(false);
  expect(isOfflineError(new Error("Unknown failure"))).toBe(false);
});
