import "../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ConnectionsSettingsPanel } from "./ConnectionsSettingsPanel";
import type { GraftConnectionsStatus } from "~/graftConnections";

const api = vi.hoisted(() => ({
  getConnectionsStatus: vi.fn(),
  setConnectionsEnabled: vi.fn(),
  createMobilePairingLink: vi.fn(),
  connectGraftRelay: vi.fn(),
  revokeConnectionsDevice: vi.fn(),
}));

vi.mock("~/graftConnections", () => api);
vi.mock("./SshConnectionsPanel", () => ({ SshConnectionsPanel: () => null }));
vi.mock("qrcode", () => ({
  toString: async () => "<svg aria-label='pairing code' />",
}));

const clients: QueryClient[] = [];
const localStatus: GraftConnectionsStatus = {
  enabled: true,
  networkAccessEnabled: true,
  environmentId: "env",
  environmentLabel: "Studio Mac",
  bindHost: "0.0.0.0",
  port: 47831,
  endpoints: [],
  devices: [],
  pairingUrl: "graft://pair?v=1&host=http%3A%2F%2F192.168.1.20%3A47831#token=old-code",
  pairingExpiresAt: Date.now() + 300_000,
  relay: { state: "disabled", lastError: null },
  diagnostics: "",
};
const relayPairing = {
  pairingUrl:
    "graft://pair?v=1&host=https%3A%2F%2Frelay.example%2Fhost&endpointKind=relay#token=new-code",
  expiresAt: Date.now() + 300_000,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function beginPairing() {
  api.getConnectionsStatus.mockResolvedValue(localStatus);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const mounted = await render(
    <QueryClientProvider client={client}>
      <ConnectionsSettingsPanel active />
    </QueryClientProvider>,
  );
  await mounted.getByTestId("connections-add-device").click();
  await mounted.getByTestId("connections-pairing-get-started").click();
  return mounted;
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

it("hides the previous local QR until relay pairing and its status refresh finish", async () => {
  const pairing = deferred<unknown>();
  const refresh = deferred<GraftConnectionsStatus>();
  api.createMobilePairingLink.mockReturnValue(pairing.promise);
  const mounted = await beginPairing();

  await expect.element(mounted.getByText("Preparing your secure code…")).toBeVisible();
  await expect.element(mounted.getByTestId("connections-pairing-qr")).not.toBeInTheDocument();
  await expect
    .element(mounted.getByTestId("connections-copy-pairing-link"))
    .not.toBeInTheDocument();

  api.getConnectionsStatus.mockReturnValue(refresh.promise);
  pairing.resolve(relayPairing);
  await vi.waitFor(() => expect(api.getConnectionsStatus).toHaveBeenCalledTimes(2));
  await expect.element(mounted.getByText("Preparing your secure code…")).toBeVisible();
  await expect.element(mounted.getByTestId("connections-pairing-qr")).not.toBeInTheDocument();

  refresh.resolve({
    ...localStatus,
    pairingUrl: relayPairing.pairingUrl,
    relay: { state: "connected", lastError: null },
  });
  await expect.element(mounted.getByTestId("connections-pairing-qr")).toBeVisible();
  await expect.element(mounted.getByTestId("connections-copy-pairing-link")).toBeVisible();
  await expect
    .element(mounted.getByTestId("connections-pairing-reachability"))
    .toHaveTextContent("Your phone can be on any network.");
});

it("keeps the new relay code when the follow-up status refresh fails", async () => {
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const pairing = deferred<unknown>();
  api.createMobilePairingLink.mockReturnValue(pairing.promise);
  const mounted = await beginPairing();

  api.getConnectionsStatus.mockRejectedValue(new Error("Status refresh unavailable."));
  pairing.resolve(relayPairing);
  await expect.element(mounted.getByTestId("connections-pairing-qr")).toBeVisible();
  await mounted.getByTestId("connections-copy-pairing-link").click();
  expect(copy).toHaveBeenCalledWith(relayPairing.pairingUrl);
  await expect
    .element(mounted.getByTestId("connections-pairing-reachability"))
    .toHaveTextContent("Your phone can be on any network.");
});

it("keeps the old local QR hidden when connecting the relay fails", async () => {
  const pairing = deferred<unknown>();
  api.createMobilePairingLink.mockReturnValue(pairing.promise);
  const mounted = await beginPairing();

  pairing.reject(new Error("The relay is unavailable. Try again."));
  await expect
    .element(mounted.getByTestId("connections-pairing-qr-step"))
    .toHaveTextContent("The relay is unavailable. Try again.");
  await expect.element(mounted.getByTestId("connections-pairing-qr")).not.toBeInTheDocument();
  await expect
    .element(mounted.getByTestId("connections-copy-pairing-link"))
    .not.toBeInTheDocument();
});
