import { afterEach, describe, expect, it } from "vitest";

import {
  formatHostForUrl,
  firstReachableIpv4Address,
  getBoundListenPort,
  isLoopbackHost,
  isWildcardHost,
  mobilePairingBaseUrl,
  resolveListeningPort,
  setBoundListenPort,
} from "./startupAccess";

afterEach(() => {
  setBoundListenPort(0);
});

describe("startupAccess", () => {
  it("detects wildcard hosts", () => {
    expect(isWildcardHost("0.0.0.0")).toBe(true);
    expect(isWildcardHost("::")).toBe(true);
    expect(isWildcardHost("127.0.0.1")).toBe(false);
  });

  it("detects loopback hosts", () => {
    expect(isLoopbackHost(undefined)).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.50")).toBe(false);
  });

  it("formats IPv6 hosts for URLs", () => {
    expect(formatHostForUrl("::1")).toBe("[::1]");
    expect(formatHostForUrl("127.0.0.1")).toBe("127.0.0.1");
  });

  it("prefers the actual bound port when an HTTP server address is available", () => {
    expect(resolveListeningPort({ port: 4123 }, 3773)).toBe(4123);
    expect(resolveListeningPort("pipe", 3773)).toBe(3773);
    expect(resolveListeningPort(null, 3773)).toBe(3773);
  });

  it("picks the first non-internal IPv4 address", () => {
    const internal = {
      address: "127.0.0.1",
      netmask: "255.0.0.0",
      family: "IPv4" as const,
      mac: "00:00:00:00:00:00",
      internal: true,
      cidr: "127.0.0.1/8",
    };
    const lan = {
      address: "192.168.1.20",
      netmask: "255.255.255.0",
      family: "IPv4" as const,
      mac: "00:00:00:00:00:00",
      internal: false,
      cidr: "192.168.1.20/24",
    };
    expect(firstReachableIpv4Address({ lo: [internal], wlan0: [lan] })).toBe("192.168.1.20");
  });

  it("builds a phone-reachable pairing origin when the server binds a wildcard", () => {
    expect(
      mobilePairingBaseUrl({
        host: "0.0.0.0",
        port: 3773,
        fallback: "http://localhost:3773",
        lanAddress: "192.168.1.20",
      }),
    ).toBe("http://192.168.1.20:3773");
  });

  it("keeps a configured public origin for pairing links", () => {
    expect(
      mobilePairingBaseUrl({
        host: "0.0.0.0",
        port: 3773,
        publicUrl: new URL("https://graft.example"),
        fallback: "http://localhost:3773",
        lanAddress: "192.168.1.20",
      }),
    ).toBe("https://graft.example");
  });

  it("keeps the request origin when the server is bound to loopback", () => {
    expect(
      mobilePairingBaseUrl({
        host: "127.0.0.1",
        port: 3773,
        fallback: "http://localhost:3773",
        lanAddress: "192.168.1.20",
      }),
    ).toBe("http://localhost:3773");
  });

  it("uses the resolved listening port after the server binds port 0", () => {
    expect(getBoundListenPort(0)).toBe(0);
    setBoundListenPort(4123);
    expect(getBoundListenPort(0)).toBe(4123);
    expect(
      mobilePairingBaseUrl({
        host: "0.0.0.0",
        port: getBoundListenPort(0),
        fallback: "http://localhost:0",
        lanAddress: "192.168.1.20",
      }),
    ).toBe("http://192.168.1.20:4123");
  });
});
