import { GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES } from "@graft/shared";
import { describe, expect, it, vi } from "vitest";
import { DESKTOP_MESSAGE_CONTRACT_REGISTRY } from "./contracts/registry";
import {
  authorizeDesktopCommand,
  DESKTOP_COMMAND_POLICIES,
  type DesktopCommandType,
} from "./desktopCommandOwnership";

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

const allCapabilities = [
  "projects",
  "spaces",
  "threads",
  "runs",
  "providers",
  "files",
  "git",
  "diffs",
  "worktrees",
  "terminals",
  "skills",
  "mcp",
  "actions",
  "automations",
  "lsp",
  "usage",
  "external_mcp",
  "app_server",
  "cursor_replay",
  "bulk_transfer",
  "diagnostics",
] as const;

function authorize(
  commandType: string,
  overrides: Partial<Parameters<typeof authorizeDesktopCommand>[0]> = {},
) {
  return authorizeDesktopCommand({
    commandType,
    sessionProfile: "desktop_occupancy",
    hostCapabilities: allCapabilities,
    sessionGrants: allCapabilities,
    clientCapabilities: allCapabilities,
    ...overrides,
  });
}

describe("desktop command ownership", () => {
  const commands = DESKTOP_MESSAGE_CONTRACT_REGISTRY.descriptors.filter(
    (descriptor) => descriptor.kind === "command",
  );

  it("classifies every desktop command exactly once", () => {
    expect(commands).toHaveLength(232);
    expect(sorted(Object.keys(DESKTOP_COMMAND_POLICIES))).toEqual(
      sorted(commands.map((descriptor) => descriptor.type)),
    );
  });

  it("keeps all physical fixed-channel commands on the client", () => {
    const fixedCommands = commands.filter(
      (descriptor) => descriptor.route.transport === "fixed",
    );
    expect(fixedCommands).toHaveLength(43);
    for (const descriptor of fixedCommands) {
      expect(DESKTOP_COMMAND_POLICIES[descriptor.type].owner).toBe("client");
    }
  });

  it("locks representative host, client, split, and unsupported decisions", () => {
    expect(DESKTOP_COMMAND_POLICIES["files/write"]).toEqual({
      owner: "host",
      capability: "files",
    });
    expect(DESKTOP_COMMAND_POLICIES["pty/write"]).toEqual({
      owner: "host",
      capability: "terminals",
    });
    expect(DESKTOP_COMMAND_POLICIES["app/bootstrap"]).toEqual({
      owner: "host",
      capability: "projects",
    });
    expect(DESKTOP_COMMAND_POLICIES["thread/checkpoints/page"]).toEqual({
      owner: "host",
      capability: "threads",
    });
    expect(DESKTOP_COMMAND_POLICIES["dialog/openFiles"]).toEqual({
      owner: "client",
    });
    expect(DESKTOP_COMMAND_POLICIES["files/import"]).toEqual({
      owner: "split",
    });
    expect(DESKTOP_COMMAND_POLICIES["turn/start"]).toEqual({
      owner: "split",
    });
    expect(DESKTOP_COMMAND_POLICIES["thread/export"]).toEqual({
      owner: "unsupported_remote",
    });
    expect(DESKTOP_COMMAND_POLICIES["project/revealInFinder"]).toEqual({
      owner: "unsupported_remote",
    });
  });

  it("allows host commands only through the complete capability intersection", () => {
    expect(authorize("files/write")).toMatchObject({ allowed: true });
    expect(
      authorize("files/write", { hostCapabilities: ["projects"] }),
    ).toMatchObject({ allowed: false, reason: "host_unsupported" });
    expect(
      authorize("files/write", { sessionGrants: ["projects"] }),
    ).toMatchObject({ allowed: false, reason: "missing_grant" });
    expect(
      authorize("files/write", { clientCapabilities: ["projects"] }),
    ).toMatchObject({ allowed: false, reason: "client_unsupported" });
  });

  it("rejects mobile, client, split, unsupported, and unknown dispatches", () => {
    expect(
      authorize("files/write", { sessionProfile: "mobile_companion" }),
    ).toMatchObject({ allowed: false, reason: "wrong_profile" });
    expect(authorize("dialog/openFiles")).toMatchObject({
      allowed: false,
      reason: "client_owned",
    });
    expect(authorize("files/import")).toMatchObject({
      allowed: false,
      reason: "split_command",
    });
    expect(authorize("skills/openFolder")).toMatchObject({
      allowed: false,
      reason: "unsupported_remote",
    });
    expect(authorize("future/unsafe-command")).toMatchObject({
      allowed: false,
      reason: "unknown_command",
    });
  });

  it("supports an authorization-before-dispatch boundary", () => {
    const handler = vi.fn();
    const decision = authorize("files/write", {
      sessionProfile: "mobile_companion",
    });
    if (decision.allowed) handler();
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps host ownership in lockstep with the implemented daemon table", () => {
    const splitCommands = new Set(["turn/start", "files/import"]);
    for (const [commandType, policy] of Object.entries(
      DESKTOP_COMMAND_POLICIES,
    )) {
      if (policy.owner !== "host") continue;
      expect(GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES).toHaveProperty(
        commandType,
        policy.capability,
      );
    }
    for (const [commandType, capability] of Object.entries(
      GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES,
    )) {
      const policy =
        DESKTOP_COMMAND_POLICIES[commandType as DesktopCommandType];
      if (splitCommands.has(commandType)) {
        expect(policy).toEqual({ owner: "split" });
      } else {
        expect(policy).toEqual({ owner: "host", capability });
      }
    }
  });
});
