import { readFileSync } from "node:fs";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import { toWebSocketBaseUrl, type GraftRemoteEndpointKind } from "@graft/mobile-contract";

import { isLoopbackHost } from "../startupAccess";

/** Kinds discoverable from this host's own network interfaces. */
export type LocalNetworkEndpointKind = "loopback" | "lan" | "tailnet";

export type DiscoveredNetworkEndpoint = {
  kind: GraftRemoteEndpointKind;
  address: string;
  interfaceName: string;
  httpBaseUrl: string;
  wsBaseUrl: string;
  reachabilityRank?: number;
};

export type NetworkInterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;

export type DiscoverNetworkEndpointsOptions = {
  readonly defaultRouteInterface?: string | null;
  readonly includeIpv6?: boolean;
};

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
const VIRTUAL_INTERFACE_PATTERN =
  /^(docker\d*|br-|bridge|veth|virbr|cni|flannel|lxc|lxd|vboxnet|vmnet|podman|ham\d+|tun|tap|wg)/i;
const PHYSICAL_INTERFACE_PATTERN = /^(en|eth|em|igb|ix|re|wl|wlan|wlp|wwan)/i;

export function discoverNetworkEndpoints(
  port: number,
  interfaces: NetworkInterfaceMap = networkInterfaces(),
  options: DiscoverNetworkEndpointsOptions = {},
): DiscoveredNetworkEndpoint[] {
  const includeIpv6 = options.includeIpv6 !== false;
  const defaultRouteInterface =
    options.defaultRouteInterface === undefined
      ? detectDefaultIpv4RouteInterface()
      : options.defaultRouteInterface;
  const candidates: Array<{
    address: string;
    interfaceName: string;
    kind: LocalNetworkEndpointKind;
    reachabilityRank: number;
  }> = [
    {
      address: "127.0.0.1",
      interfaceName: "Loopback",
      kind: "loopback",
      reachabilityRank: 4,
    },
  ];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const address = stripIpv6Zone(entry.address);
      if (!includeIpv6 && address.includes(":")) continue;
      const kind = classifyNetworkAddress(address, entry.family);
      if (!kind || kind === "loopback") continue;
      candidates.push({
        address,
        interfaceName,
        kind,
        reachabilityRank: lanInterfaceRank(interfaceName, defaultRouteInterface),
      });
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
        kind: candidate.kind,
        address: candidate.address,
        interfaceName: candidate.interfaceName,
        httpBaseUrl,
        wsBaseUrl: toWebSocketBaseUrl(httpBaseUrl),
        reachabilityRank: candidate.reachabilityRank,
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

export function resolveAdvertisedMobilePairingBase(input: {
  readonly relay?: DiscoveredNetworkEndpoint | null;
  readonly publicUrl?: URL | undefined;
  readonly preferred: DiscoveredNetworkEndpoint | null;
  readonly requestHttpBaseUrl: string | null;
}): { readonly httpBaseUrl: string; readonly endpointKind: GraftRemoteEndpointKind } | null {
  if (input.relay) return { httpBaseUrl: input.relay.httpBaseUrl, endpointKind: input.relay.kind };
  if (input.publicUrl) {
    const httpBaseUrl = input.publicUrl.origin;
    return { httpBaseUrl, endpointKind: pairingEndpointKind(httpBaseUrl) };
  }
  if (input.preferred && !isLoopbackHost(input.preferred.address)) {
    return { httpBaseUrl: input.preferred.httpBaseUrl, endpointKind: input.preferred.kind };
  }
  if (!input.requestHttpBaseUrl) {
    if (!input.preferred) return null;
    return { httpBaseUrl: input.preferred.httpBaseUrl, endpointKind: input.preferred.kind };
  }
  if (input.preferred) {
    return { httpBaseUrl: input.preferred.httpBaseUrl, endpointKind: input.preferred.kind };
  }
  return {
    httpBaseUrl: input.requestHttpBaseUrl,
    endpointKind: pairingEndpointKind(input.requestHttpBaseUrl),
  };
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

export function defaultIpv4RouteInterfaceFromProcNet(table: string): string | null {
  let best: { iface: string; metric: number } | null = null;
  for (const line of table.split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/u);
    if (columns.length < 8) continue;
    const iface = columns[0];
    const destination = columns[1];
    const metric = Number(columns[6]);
    if (!iface || destination !== "00000000" || !Number.isFinite(metric)) continue;
    if (!best || metric < best.metric) best = { iface, metric };
  }
  return best?.iface ?? null;
}

function detectDefaultIpv4RouteInterface(): string | null {
  try {
    return defaultIpv4RouteInterfaceFromProcNet(readFileSync("/proc/net/route", "utf8"));
  } catch {
    return null;
  }
}

function lanInterfaceRank(interfaceName: string, defaultRouteInterface: string | null): number {
  const name = interfaceName.toLowerCase();
  if (VIRTUAL_INTERFACE_PATTERN.test(name)) return 3;
  if (defaultRouteInterface && name === defaultRouteInterface.toLowerCase()) return 0;
  if (PHYSICAL_INTERFACE_PATTERN.test(name)) return 1;
  return 2;
}

function compareEndpointPreference(
  left: {
    kind: GraftRemoteEndpointKind;
    interfaceName: string;
    address: string;
    reachabilityRank?: number;
  },
  right: {
    kind: GraftRemoteEndpointKind;
    interfaceName: string;
    address: string;
    reachabilityRank?: number;
  },
): number {
  const byKind = KIND_PRIORITY[left.kind] - KIND_PRIORITY[right.kind];
  if (byKind !== 0) return byKind;
  const byFamily = Number(left.address.includes(":")) - Number(right.address.includes(":"));
  if (byFamily !== 0) return byFamily;
  const leftRank = left.reachabilityRank ?? lanInterfaceRank(left.interfaceName, null);
  const rightRank = right.reachabilityRank ?? lanInterfaceRank(right.interfaceName, null);
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.address.localeCompare(right.address);
}

function pairingEndpointKind(httpBaseUrl: string): GraftRemoteEndpointKind {
  const url = new URL(httpBaseUrl);
  if (url.protocol === "https:") {
    return url.hostname.endsWith(".ts.net") ? "tailnet" : "https";
  }
  return isLoopbackHost(url.hostname) ? "loopback" : "lan";
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
