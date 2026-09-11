import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GRAFT_DESKTOP_CAPABILITIES,
  GRAFT_DESKTOP_ENDPOINTS,
  GraftDesktopBootstrapResponseSchema,
  GraftDesktopBulkTransferTicketSchema,
  GraftDesktopBulkUploadRequestSchema,
  GraftDesktopBulkUploadResultSchema,
  GraftDesktopClientMessageSchema,
  GraftDesktopEnrollmentRequestSchema,
  GraftDesktopEnrollmentResponseSchema,
  GraftDesktopHostMessageSchema,
  GraftDesktopHealthSchema,
  GraftDesktopSessionRecordSchema,
  GraftDesktopStreamFrameSchema,
  negotiateDesktopCapabilities,
} from "./index";
const environmentId = "environment-fedora-01";
const sessionId = "session-desktop-01";
const commandId = "11111111-1111-4111-8111-111111111111";
const requestHash = "a".repeat(64);
const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../protocol-fixtures/desktop-v1",
);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function listFixtures(kind: "valid" | "invalid"): string[] {
  return readdirSync(join(fixturesRoot, kind))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function schemaForFixture(name: string) {
  if (name.startsWith("health")) return GraftDesktopHealthSchema;
  if (name.startsWith("bootstrap")) return GraftDesktopBootstrapResponseSchema;
  if (name.startsWith("enrollment-request")) {
    return GraftDesktopEnrollmentRequestSchema;
  }
  if (name.startsWith("enrollment-response")) {
    return GraftDesktopEnrollmentResponseSchema;
  }
  if (name.startsWith("session-")) return GraftDesktopSessionRecordSchema;
  if (name.startsWith("client-")) return GraftDesktopClientMessageSchema;
  if (name.startsWith("host-")) return GraftDesktopHostMessageSchema;
  if (name.startsWith("stream-")) return GraftDesktopStreamFrameSchema;
  if (name.startsWith("bulk-")) return GraftDesktopBulkTransferTicketSchema;
  throw new Error(`No schema mapping for desktop fixture ${name}`);
}

describe("desktop host protocol", () => {
  it("uses endpoints that cannot be confused with the mobile gateway", () => {
    expect(GRAFT_DESKTOP_ENDPOINTS).toEqual({
      health: "/desktop/v1/health",
      enroll: "/desktop/v1/enroll",
      session: "/desktop/v1/session",
      socket: "/desktop/v1/ws",
      bulk: "/desktop/v1/bulk",
    });
    expect(GRAFT_DESKTOP_ENDPOINTS.socket).not.toBe("/v1/ws");
  });

  it("validates an SSH bootstrap response without persisting its route", () => {
    expect(
      GraftDesktopBootstrapResponseSchema.parse({
        protocolVersion: 1,
        environmentId,
        environmentLabel: "Fedora",
        daemonVersion: "0.1.0",
        platform: { os: "linux", arch: "x64", libc: "glibc" },
        port: 47_831,
        enrollmentToken: "enrollment-token-with-at-least-32-characters",
        enrollmentExpiresAt: 1_780_000_000_000,
        activeRunCount: 0,
        activePtyCount: 0,
      }),
    ).toMatchObject({ environmentId, port: 47_831 });
  });

  it("keeps durable host sessions independent of tunnel routes and bearer text", () => {
    const session = {
      sessionId,
      environmentId,
      profile: "desktop_occupancy" as const,
      clientId: "desktop-client-01",
      clientLabel: "Brent's Mac",
      grants: ["projects", "threads"] as const,
      createdAt: 1,
      expiresAt: 2,
      lastSeenAt: 1,
      revokedAt: null,
    };

    expect(GraftDesktopSessionRecordSchema.parse(session)).toEqual(session);
    expect(
      GraftDesktopSessionRecordSchema.safeParse({
        ...session,
        wsBaseUrl: "ws://127.0.0.1:49152/desktop/v1/ws",
      }).success,
    ).toBe(false);
    expect(
      GraftDesktopSessionRecordSchema.safeParse({
        ...session,
        bearer: "bearer-value-that-must-never-be-persisted-here",
      }).success,
    ).toBe(false);
  });

  it("returns a bearer only from the one-time enrollment exchange", () => {
    const parsed = GraftDesktopEnrollmentResponseSchema.parse({
      protocolVersion: 1,
      session: {
        sessionId,
        environmentId,
        profile: "desktop_occupancy",
        clientId: "desktop-client-01",
        clientLabel: "Brent's Mac",
        grants: ["projects"],
        createdAt: 1,
        expiresAt: 2,
        lastSeenAt: 1,
        revokedAt: null,
      },
      bearer: "desktop-bearer-with-at-least-32-characters",
    });

    expect(parsed.session).not.toHaveProperty("bearer");
    expect(parsed.bearer).toContain("desktop-bearer");
  });

  it("enforces host capabilities intersected with grants and client support", () => {
    expect(
      negotiateDesktopCapabilities(
        ["projects", "threads", "files", "threads"],
        ["projects", "threads", "files"],
        ["projects", "files"],
      ),
    ).toEqual(["projects", "files"]);
  });

  it("validates versioned commands and durable host receipts", () => {
    expect(
      GraftDesktopClientMessageSchema.parse({
        envelope: "command",
        commandId,
        command: {
          version: 1,
          type: "project/list",
        },
      }),
    ).toMatchObject({ envelope: "command", commandId });

    expect(
      GraftDesktopHostMessageSchema.parse({
        envelope: "response",
        commandId,
        receipt: {
          commandId,
          requestHash,
          status: "completed",
          replayed: false,
          acceptedAt: 10,
          completedAt: 11,
        },
        result: { projects: [] },
      }),
    ).toMatchObject({ envelope: "response", result: { projects: [] } });
  });

  it("validates path-free bulk upload tickets", () => {
    const request = GraftDesktopBulkUploadRequestSchema.parse({
      operation: "create_upload",
      mediaType: "image/png",
      sizeBytes: 12,
      sha256: requestHash,
    });
    const result = GraftDesktopBulkUploadResultSchema.parse({
      ok: true,
      ticket: {
        transferId: commandId,
        direction: "upload",
        mediaType: request.mediaType,
        sizeBytes: request.sizeBytes,
        sha256: request.sha256,
        expiresAt: 100,
      },
    });
    expect(result.ticket).not.toHaveProperty("path");
  });

  it("rejects ambiguous responses and duplicate capabilities", () => {
    const receipt = {
      commandId,
      requestHash,
      status: "completed",
      replayed: false,
      acceptedAt: 10,
      completedAt: 11,
    };
    expect(
      GraftDesktopHostMessageSchema.safeParse({
        envelope: "response",
        commandId,
        receipt,
        result: {},
        error: {
          code: "internal_error",
          message: "failed",
          retryable: false,
        },
      }).success,
    ).toBe(false);
    expect(
      GraftDesktopClientMessageSchema.safeParse({
        envelope: "hello",
        protocolVersion: 1,
        clientVersion: "0.1.0",
        capabilities: ["projects", "projects"],
      }).success,
    ).toBe(false);
  });

  it("keeps desktop occupancy off the phone /v1 surface", () => {
    expect(GRAFT_DESKTOP_ENDPOINTS.health).toBe("/desktop/v1/health");
    expect(GRAFT_DESKTOP_ENDPOINTS.enroll).toBe("/desktop/v1/enroll");
    expect(GRAFT_DESKTOP_CAPABILITIES).toContain("files");
    expect(GRAFT_DESKTOP_CAPABILITIES).toContain("diagnostics");
    expect(
      negotiateDesktopCapabilities(["projects", "files"], ["projects"], ["projects", "files"]),
    ).toEqual(["projects"]);
  });
});

describe("desktop host protocol fixtures", () => {
  it("parses every valid fixture", () => {
    const names = listFixtures("valid");
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      expect(
        schemaForFixture(name).safeParse(
          readJson(join(fixturesRoot, "valid", name)),
        ).success,
        `${name} should parse`,
      ).toBe(true);
    }
  });

  it("rejects every invalid fixture", () => {
    const names = listFixtures("invalid");
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      expect(
        schemaForFixture(name).safeParse(
          readJson(join(fixturesRoot, "invalid", name)),
        ).success,
        `${name} should fail`,
      ).toBe(false);
    }
  });
});
