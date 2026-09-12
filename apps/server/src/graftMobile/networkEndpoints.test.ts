import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";

import {
  classifyNetworkAddress,
  discoverNetworkEndpoints,
  preferredPairingEndpoint,
  type NetworkInterfaceMap,
} from "./networkEndpoints";

function entry(
  address: string,
  family: "IPv4" | "IPv6" = address.includes(":") ? "IPv6" : "IPv4",
): NetworkInterfaceInfo {
  return {
    address,
    family,
    internal: false,
    mac: "00:00:00:00:00:00",
    netmask: family === "IPv4" ? "255.255.255.0" : "ffff:ffff:ffff:ffff::",
    cidr: null,
    scopeid: family === "IPv6" ? 0 : undefined,
  } as NetworkInterfaceInfo;
}

describe("network endpoint discovery", () => {
  it.each([
    ["127.0.0.1", "IPv4", "loopback"],
    ["10.0.0.8", "IPv4", "lan"],
    ["172.16.0.1", "IPv4", "lan"],
    ["172.31.255.254", "IPv4", "lan"],
    ["192.168.1.9", "IPv4", "lan"],
    ["100.64.0.1", "IPv4", "tailnet"],
    ["100.127.255.254", "IPv4", "tailnet"],
    ["fd7a:115c:a1e0::42", "IPv6", "tailnet"],
    ["8.8.8.8", "IPv4", null],
    ["169.254.1.1", "IPv4", null],
    ["224.0.0.1", "IPv4", null],
    ["0.0.0.0", "IPv4", null],
    ["fe80::1", "IPv6", null],
    ["ff02::1", "IPv6", null],
    ["::", "IPv6", null],
    ["2001:4860:4860::8888", "IPv6", null],
  ] as const)("classifies %s", (address, family, expected) => {
    expect(classifyNetworkAddress(address, family)).toBe(expected);
  });

  it("deduplicates, excludes unusable addresses, and prefers Tailnet then LAN then loopback", () => {
    const interfaces: NetworkInterfaceMap = {
      en1: [entry("192.168.1.20"), entry("8.8.8.8")],
      en0: [entry("192.168.1.20"), entry("10.0.0.9")],
      tailscale0: [entry("100.70.80.90"), entry("fd7a:115c:a1e0::42"), entry("fe80::5")],
    };

    const endpoints = discoverNetworkEndpoints(47831, interfaces);

    expect(endpoints.map(({ kind, address }) => ({ kind, address }))).toEqual([
      { kind: "tailnet", address: "100.70.80.90" },
      { kind: "tailnet", address: "fd7a:115c:a1e0::42" },
      { kind: "lan", address: "10.0.0.9" },
      { kind: "lan", address: "192.168.1.20" },
      { kind: "loopback", address: "127.0.0.1" },
    ]);
    expect(endpoints[1]?.httpBaseUrl).toBe("http://[fd7a:115c:a1e0::42]:47831");
    expect(preferredPairingEndpoint(endpoints)?.address).toBe("100.70.80.90");
    expect(endpoints.some((endpoint) => endpoint.address === "0.0.0.0")).toBe(false);
  });
});
