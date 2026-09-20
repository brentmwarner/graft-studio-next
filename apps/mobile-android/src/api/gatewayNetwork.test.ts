import { NetworkStateType, type NetworkState } from "expo-network";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { watchGatewayNetwork } from "./gatewayNetwork";

const network = vi.hoisted(() => ({
  listener: undefined as ((state: NetworkState) => void) | undefined,
  initial: undefined as ((state: NetworkState) => void) | undefined,
  remove: vi.fn(),
}));
vi.mock("expo-network", () => ({
  NetworkStateType: { WIFI: "WIFI", CELLULAR: "CELLULAR", NONE: "NONE", UNKNOWN: "UNKNOWN" },
  addNetworkStateListener: (listener: (state: NetworkState) => void) => {
    network.listener = listener;
    return { remove: network.remove };
  },
  getNetworkStateAsync: () =>
    new Promise<NetworkState>((resolve) => {
      network.initial = resolve;
    }),
}));
const socket = { networkChanged: vi.fn() };
let stop: () => void;
const wifi = { type: NetworkStateType.WIFI, isConnected: true, isInternetReachable: true };
const cellular = { ...wifi, type: NetworkStateType.CELLULAR };
beforeEach(() => {
  vi.clearAllMocks();
  stop = watchGatewayNetwork(socket);
});
afterEach(() => stop());

it("reconnects on Wi-Fi/cellular transitions without resetting for duplicate notifications", async () => {
  network.initial!(wifi);
  await Promise.resolve();
  network.listener!(cellular);
  network.listener!(cellular);
  network.listener!(wifi);
  expect(socket.networkChanged.mock.calls).toEqual([[true], [true]]);
});

it("does not let a stale initial read overwrite a newer route notification", async () => {
  network.listener!(cellular);
  network.initial!(wifi);
  await Promise.resolve();
  network.listener!(cellular);
  expect(socket.networkChanged).not.toHaveBeenCalled();
});

it("applies an initial offline read after an unknown native event", async () => {
  network.listener!({ type: NetworkStateType.UNKNOWN, isConnected: false });
  network.initial!({ type: NetworkStateType.NONE, isConnected: false });
  await Promise.resolve();
  expect(socket.networkChanged.mock.calls).toEqual([[false]]);

  network.listener!(cellular);
  expect(socket.networkChanged.mock.calls).toEqual([[false], [true]]);
});

it("pauses while offline and resumes even on the same network type", () => {
  network.listener!(wifi);
  network.listener!({ ...wifi, isConnected: false });
  network.listener!(wifi);
  expect(socket.networkChanged.mock.calls).toEqual([[false], [true]]);
});

it("allows a local-only LAN but retries when internet validation recovers", () => {
  network.listener!({ ...wifi, isInternetReachable: false });
  expect(socket.networkChanged).not.toHaveBeenCalled();
  network.listener!(wifi);
  expect(socket.networkChanged).toHaveBeenCalledWith(true);
});

it("keeps socket deadlines active if native cannot determine network state", () => {
  network.listener!({ type: NetworkStateType.UNKNOWN, isConnected: false });
  expect(socket.networkChanged).not.toHaveBeenCalled();
});

it("ignores initial reads and queued events after cleanup", async () => {
  stop();
  network.initial!(wifi);
  await Promise.resolve();
  network.listener!({ type: NetworkStateType.NONE, isConnected: false });
  expect(socket.networkChanged).not.toHaveBeenCalled();
  expect(network.remove).toHaveBeenCalled();
});
