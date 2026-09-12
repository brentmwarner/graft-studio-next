import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import { toWebSocketBaseUrl, type GraftRemoteEndpointKind } from "@graft/mobile-contract";

/** Kinds discoverable from this host's own network interfaces. */
export type LocalNetworkEndpointKind = "loopback" | "lan" | "tailnet";

export type DiscoveredNetworkEndpoint = {
  kind: GraftRemoteEndpointKind;
  address: string;
  interfaceName: string;
  httpBaseUrl: string;
  wsBaseUrl: string;
};

export type NetworkInterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * A connected relay reaches the phone from anywhere, so it outranks every
 * endpoint that requires the phone to be on a particular network.
 */
const KIND_PRIORITY: Record<GraftRemoteEndpointKind, number> = {
  relay: -1,
  tailnet: 0,
  lan: 1,
  loopback: 2,
  https: 3,
};

const RELAY_INTERFACE_NAME = "Graft Relay";

export function discoverNetworkEndpoints(
  port: number,
  interfaces: NetworkInterfaceMap = networkInterfaces(),
): DiscoveredNetworkEndpoint[] {
  const candidates: Array<{
    address: string;
    interfaceName: string;
    kind: LocalNetworkEndpointKind;
  }> = [
    {
      address: "127.0.0.1",
      interfaceName: "Loopback",
      kind: "loopback",
    },
  ];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const address = stripIpv6Zone(entry.address);
      const kind = classifyNetworkAddress(address, entry.family);
      if (!kind || kind === "loopback") continue;
      candidates.push({ address, interfaceName, kind });
    }
  }

  const seenAddresses = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = candidate.address.toLowerCase();
      if (seenAddresses.has(key)) return false;
      seenAddresses.add(key);
      return true;
    })
    .sort(compareEndpointPreference)
    .map((candidate) => {
      const httpBaseUrl = `http://${formatUrlHost(candidate.address)}:${port}`;
      return {
        ...candidate,
        httpBaseUrl,
        wsBaseUrl: toWebSocketBaseUrl(httpBaseUrl),
      };
    });
}

export function preferredPairingEndpoint(
  endpoints: readonly DiscoveredNetworkEndpoint[],
): DiscoveredNetworkEndpoint | null {
  return sortEndpointsByPreference(endpoints)[0] ?? null;
}

export function sortEndpointsByPreference(
  endpoints: readonly DiscoveredNetworkEndpoint[],
): DiscoveredNetworkEndpoint[] {
  return [...endpoints].sort(compareEndpointPreference);
}

/**
 * Synthesize the endpoint a connected relay advertises. It has no local
 * interface, so `address` carries the relay host and `interfaceName` names the
 * relay itself — both purely for display and diagnostics.
 */
export function relayNetworkEndpoint(input: {
  httpBaseUrl: string;
  wsBaseUrl: string;
}): DiscoveredNetworkEndpoint {
  return {
    kind: "relay",
    address: new URL(input.httpBaseUrl).host,
    interfaceName: RELAY_INTERFACE_NAME,
    httpBaseUrl: input.httpBaseUrl,
    wsBaseUrl: input.wsBaseUrl,
  };
}

function compareEndpointPreference(
  left: { kind: GraftRemoteEndpointKind; interfaceName: string; address: string },
  right: { kind: GraftRemoteEndpointKind; interfaceName: string; address: string },
): number {
  const byKind = KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind];
  if (byKind !== 0) return byKind;
  const byInterface = left.interfaceName.localeCompare(right.interfaceName);
  return byInterface || left.address.localeCompare(right.address);
}

export function classifyNetworkAddress(
  address: string,
  family?: string | number,
): LocalNetworkEndpointKind | null {
  const normalized = stripIpv6Zone(address).toLowerCase();
  const isIpv6 = family === "IPv6" || family === 6 || normalized.includes(":");

  if (isIpv6) {
    if (normalized === "::1") return "loopback";
    if (normalized.startsWith("fd7a:115c:a1e0:")) return "tailnet";
    return null;
  }

  const octets = normalized.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  const [first, second] = octets;
  if (first === 127) return "loopback";
  if (first === 100 && second !== undefined && second >= 64 && second <= 127) {
    return "tailnet";
  }
  if (first === 10) return "lan";
  if (first === 172 && second !== undefined && second >= 16 && second <= 31) {
    return "lan";
  }
  if (first === 192 && second === 168) return "lan";
  return null;
}

function stripIpv6Zone(address: string): string {
  return address.split("%", 1)[0] ?? address;
}

function formatUrlHost(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}
