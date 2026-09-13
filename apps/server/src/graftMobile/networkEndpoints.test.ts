import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";

import {
  classifyNetworkAddress,
  defaultIpv4RouteInterfaceFromProcNet,
  discoverNetworkEndpoints,
  preferredPairingEndpoint,
  resolveAdvertisedMobilePairingBase,
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

    const endpoints = discoverNetworkEndpoints(47831, interfaces, {
      defaultRouteInterface: null,
    });

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

  it("prefers Wi-Fi over Docker and VM bridges for LAN pairing", () => {
    const interfaces: NetworkInterfaceMap = {
      docker0: [entry("172.17.0.1")],
      bridge100: [entry("192.168.64.1")],
      wlan0: [entry("192.168.1.20")],
    };

    const endpoints = discoverNetworkEndpoints(47831, interfaces, {
      defaultRouteInterface: null,
    });

    expect(preferredPairingEndpoint(endpoints)?.address).toBe("192.168.1.20");
  });

  it("prefers the default-route interface among LAN addresses", () => {
    const interfaces: NetworkInterfaceMap = {
      docker0: [entry("172.17.0.1")],
      en0: [entry("10.0.0.8")],
      wlan0: [entry("192.168.1.20")],
    };

    const endpoints = discoverNetworkEndpoints(47831, interfaces, {
      defaultRouteInterface: "en0",
    });

    expect(preferredPairingEndpoint(endpoints)?.address).toBe("10.0.0.8");
  });

  it("does not advertise a Docker default-route address over Wi-Fi", () => {
    const interfaces: NetworkInterfaceMap = {
      docker0: [entry("172.17.0.1")],
      wlan0: [entry("192.168.1.20")],
    };

    const endpoints = discoverNetworkEndpoints(47831, interfaces, {
      defaultRouteInterface: "docker0",
    });

    expect(preferredPairingEndpoint(endpoints)?.address).toBe("192.168.1.20");
  });

  it("omits IPv6 Tailnet addresses when the LAN gateway is IPv4-only", () => {
    const interfaces: NetworkInterfaceMap = {
      tailscale0: [entry("100.70.80.90"), entry("fd7a:115c:a1e0::42")],
    };

    const endpoints = discoverNetworkEndpoints(47831, interfaces, {
      defaultRouteInterface: null,
      includeIpv6: false,
    });

    expect(endpoints.map((endpoint) => endpoint.address)).toEqual(["100.70.80.90", "127.0.0.1"]);
  });

  it("reads the default IPv4 route interface from /proc/net/route", () => {
    const table = [
      "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
      "docker0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0",
      "wlan0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0",
    ].join("\n");

    expect(defaultIpv4RouteInterfaceFromProcNet(table)).toBe("wlan0");
  });

  it("keeps a configured public URL ahead of discovered Tailnet and LAN addresses", () => {
    const preferred = discoverNetworkEndpoints(
      47831,
      { tailscale0: [entry("100.70.80.90")] },
      { defaultRouteInterface: null },
    )[0];

    expect(
      resolveAdvertisedMobilePairingBase({
        publicUrl: new URL("https://graft.example.test/"),
        preferred: preferred ?? null,
        requestHttpBaseUrl: "http://127.0.0.1:3773",
      }),
    ).toEqual({
      httpBaseUrl: "https://graft.example.test",
      endpointKind: "https",
    });
  });
});
