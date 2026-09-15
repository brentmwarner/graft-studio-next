// FILE: ConnectionsPanel.browser.tsx
// Purpose: Lock the quiet mobile pairing dialog and connection-option controls.
// Layer: Browser UI test

import "../../index.css";

import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  ConnectionsPanel,
  type ConnectionsPanelProps,
  type ConnectionsStatus,
} from "./ConnectionsPanel";

const qrMocks = vi.hoisted(() => ({
  toString: vi.fn(() => Promise.resolve("<svg aria-label='pairing code' />")),
}));

vi.mock("qrcode", () => ({ toString: qrMocks.toString }));

const status: ConnectionsStatus = {
  enabled: true,
  networkAccessEnabled: true,
  keepHostAwake: false,
  environmentId: "env",
  environmentLabel: "Studio Mac",
  bindHost: "0.0.0.0",
  port: 47831,
  endpoints: [
    {
      kind: "tailnet",
      address: "100.90.80.70",
      interfaceName: "Tailscale",
      httpBaseUrl: "http://100.90.80.70:47831",
      wsBaseUrl: "ws://100.90.80.70:47831",
    },
    {
      kind: "lan",
      address: "192.168.1.20",
      interfaceName: "Wi-Fi",
      httpBaseUrl: "http://192.168.1.20:47831",
      wsBaseUrl: "ws://192.168.1.20:47831",
    },
    {
      kind: "loopback",
      address: "127.0.0.1",
      interfaceName: "Loopback",
      httpBaseUrl: "http://127.0.0.1:47831",
      wsBaseUrl: "ws://127.0.0.1:47831",
    },
  ],
  devices: [
    {
      deviceId: "dev-1",
      sessionId: "sess-1",
      label: "Brent's iPhone",
      platform: "ios",
      appVersion: "1.2.0",
      environmentLabel: "Studio Mac",
      lastSeenAt: Date.now(),
      connected: true,
    },
  ],
  pairingUrl: null,
  pairingExpiresAt: null,
  relay: { state: "disabled", lastError: null },
};

const handlers: Omit<ConnectionsPanelProps, "status"> = {
  onRefresh: () => undefined,
  onSetEnabled: () => undefined,
  onSetKeepHostAwake: () => undefined,
  onCreatePairing: () => undefined,
  onCopyEndpoint: () => undefined,
  onRevokeDevice: () => undefined,
  onCopyDiagnostics: () => undefined,
};

afterEach(() => {
  qrMocks.toString.mockReset();
  qrMocks.toString.mockResolvedValue("<svg aria-label='pairing code' />");
});

it("opens the quiet pairing dialog and starts pairing from Get started", async () => {
  const onCreatePairing = vi.fn();
  const mounted = await render(
    <ConnectionsPanel {...handlers} status={status} onCreatePairing={onCreatePairing} />,
  );

  await mounted.getByRole("button", { name: "Connection details" }).click();
  await expect.element(mounted.getByTestId("connections-endpoint-lan")).toBeVisible();
  await mounted.getByTestId("connections-add-device").click();
  await expect
    .element(mounted.getByRole("dialog", { name: "Connect a device to this computer" }))
    .toBeVisible();
  await expect.element(mounted.getByText("Pick up where you left off")).toBeVisible();
  await mounted.getByTestId("connections-pairing-get-started").click();
  expect(onCreatePairing).toHaveBeenCalled();
  await expect.element(mounted.getByText("Scan with Graft Mobile")).toBeVisible();
});

it("renders a local QR without fetching a remote image", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const mounted = await render(
    <ConnectionsPanel
      {...handlers}
      defaultPairingDialogStep="qr"
      status={{
        ...status,
        pairingUrl:
          "graft://pair?v=1&host=http%3A%2F%2F100.90.80.70%3A47831&label=Studio%20Mac&endpointKind=tailnet#token=abcdefghijklmnopqrstuv",
        pairingExpiresAt: Date.now() + 60_000,
      }}
    />,
  );

  const qr = mounted.getByRole("img", { name: "Scan to pair Graft Mobile with Studio Mac" });
  await expect.element(qr).toBeVisible();
  expect(qr.element().getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("keeps the pairing link usable when QR encoding fails", async () => {
  qrMocks.toString.mockRejectedValueOnce(new Error("QR encoding failed"));
  const mounted = await render(
    <ConnectionsPanel
      {...handlers}
      defaultPairingDialogStep="qr"
      status={{
        ...status,
        pairingUrl:
          "graft://pair?v=1&host=http%3A%2F%2F100.90.80.70%3A47831#token=abcdefghijklmnopqrstuv",
        pairingExpiresAt: Date.now() + 60_000,
      }}
    />,
  );

  await expect
    .element(mounted.getByText("QR unavailable. Use the pairing link below."))
    .toBeVisible();
  await expect.element(mounted.getByTestId("connections-pairing-url")).toBeVisible();
});

it("invokes Connect Graft account from the relay status row", async () => {
  const onConnectRelay = vi.fn();
  const mounted = await render(
    <ConnectionsPanel {...handlers} status={status} onConnectRelay={onConnectRelay} />,
  );

  const connect = mounted.getByRole("button", { name: "Connect Graft account" });
  await expect.element(connect).toBeEnabled();
  await connect.click();
  expect(onConnectRelay).toHaveBeenCalledOnce();
});
