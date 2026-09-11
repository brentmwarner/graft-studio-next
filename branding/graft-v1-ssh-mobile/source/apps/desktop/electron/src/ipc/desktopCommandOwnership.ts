import {
  GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES,
  type GraftDesktopCapability,
} from "@graft/shared";
import { DESKTOP_MESSAGE_CONTRACT_REGISTRY } from "./contracts/registry";

type DesktopDescriptor =
  (typeof DESKTOP_MESSAGE_CONTRACT_REGISTRY.descriptors)[number];
type DesktopCommandDescriptor = Extract<DesktopDescriptor, { kind: "command" }>;
export type DesktopCommandType = DesktopCommandDescriptor["type"];

export type DesktopCommandOwner =
  | "host"
  | "client"
  | "split"
  | "unsupported_remote";

export type DesktopCommandPolicy = Readonly<{
  owner: DesktopCommandOwner;
  capability?: GraftDesktopCapability;
}>;

type PolicyDefinition = Readonly<{
  policy: DesktopCommandPolicy;
  commands: readonly DesktopCommandType[];
}>;

function hostPolicy(
  capability: GraftDesktopCapability,
  commands: readonly DesktopCommandType[],
): PolicyDefinition {
  return { policy: { owner: "host", capability }, commands };
}

const POLICY_DEFINITIONS = [
  hostPolicy("projects", [
    "app/bootstrap",
    "project/list",
    "project/connect",
    "project/create",
    "project/reorder",
    "project/rename",
    "project/remove",
    "project/scan-local",
    "project/browse-directory",
    "project/create-new",
  ]),
  hostPolicy("worktrees", [
    "worktree/list",
    "worktree/create",
    "worktree/delete",
    "worktree/handoff/apply",
    "worktree/handoff/overwrite",
  ]),
  hostPolicy("spaces", [
    "space/list",
    "space/create",
    "space/update",
    "space/delete",
    "space/reorder",
    "space/assign-project",
  ]),
  hostPolicy("threads", [
    "thread/list",
    "thread/create",
    "thread/update",
    "thread/updateTrackedPr",
    "thread/archive",
    "thread/unarchive",
    "thread/delete",
    "thread/events",
    "thread/events/page",
    "thread/parts",
    "thread/parts/page",
    "thread/fork",
    "thread/handoff",
    "thread/compact",
    "thread/deleteHistoryOnly",
    "thread/rollback",
    "thread/checkpoints",
    "thread/checkpoints/page",
    "thread/checkpointDiff",
    "thread/checkpointDiffBetween",
    "thread/checkpointRestore",
    "thread/diff-stats-all",
    "thread/diff-stats-reset",
    "sessions/list",
  ]),
  hostPolicy("runs", [
    "turn/interrupt",
    "turn/steer",
    "run/list",
    "run/cancel",
    "run/retry",
    "orchestrator/agents/list-for-thread",
    "orchestrator/agent/cancel",
    "orchestrator/agents/cancel-all-for-parent",
    "session/close",
    "session/clear-context",
    "scheduler/stats",
    "approval/respond",
    "permission/respond",
    "question/respond",
  ]),
  hostPolicy("providers", [
    "model/list",
    "provider/list",
    "provider/byomKey/save",
    "provider/byomKey/delete",
    "provider/oauth/complete",
    "provider/oauth/disconnect",
    "provider/antigravity/checkSignIn",
    "provider/apiKey/save",
    "provider/apiKey/delete",
    "provider/credential",
    "provider/cursor/models",
    "provider/cli/models",
    "provider/openai/models",
    "provider/ollama/models",
  ]),
  hostPolicy("git", [
    "git/status",
    "git/statusRich",
    "git/diff",
    "git/shortstat",
    "git/branches",
    "git/branchTree",
    "git/gitWorktrees",
    "git/stage",
    "git/revert",
    "git/commit",
    "git/push",
    "git/runStackedAction",
    "git/aheadBehind",
    "git/prStatus",
    "git/createPr",
    "git/prComments",
    "git/prChecks",
    "git/mergePr",
    "git/replyToComment",
    "git/resolveThread",
    "git/prSubscribe",
    "git/prUnsubscribe",
    "git/checkout",
    "git/suggestBranchName",
    "git/createBranch",
  ]),
  hostPolicy("diffs", ["diffReview/read"]),
  hostPolicy("files", [
    "files/list",
    "files/search",
    "files/read",
    "files/write",
    "files/delete",
    "files/move",
    "files/create-folder",
    "files/copy",
    "files/watch",
    "files/unwatch",
    "designer/extract-tokens",
  ]),
  hostPolicy("external_mcp", [
    "external-mcp/list",
    "external-mcp/create",
    "external-mcp/rotate",
    "external-mcp/revoke",
  ]),
  hostPolicy("terminals", [
    "pty/create",
    "pty/snapshot",
    "pty/write",
    "pty/resize",
    "pty/clear",
    "pty/kill",
  ]),
  hostPolicy("usage", [
    "usage/threadTotals",
    "provider/read-usage",
    "usage/summary",
  ]),
  hostPolicy("skills", [
    "skills/list",
    "skills/read",
    "skills/recommended",
    "skills/toggle",
    "skills/uninstall",
    "skills/install",
    "skills/installCustom",
    "skills/search",
  ]),
  hostPolicy("mcp", ["mcp/list", "mcp/install", "mcp/remove"]),
  hostPolicy("actions", [
    "actions/list",
    "actions/create",
    "actions/delete",
    "actions/run",
    "actions/detect-dev",
  ]),
  hostPolicy("automations", [
    "automations/list",
    "automations/create",
    "automations/update",
    "automations/delete",
    "automations/runs",
    "automations/run-now",
  ]),
  hostPolicy("lsp", [
    "lsp/start",
    "lsp/stop",
    "lsp/request",
    "lsp/notify",
    "lsp/languages/list",
    "lsp/languages/install",
    "lsp/languages/uninstall",
    "lsp/languages/setEnabled",
  ]),
  hostPolicy("app_server", ["slash/forward", "slash/map", "adapter/info"]),
  {
    policy: { owner: "client" },
    commands: [
      "appsnap/get-state",
      "appsnap/set-enabled",
      "appsnap/check-shortcut",
      "appsnap/set-shortcut",
      "appsnap/request-permissions",
      "appsnap/list-pending-captures",
      "appsnap/acknowledge-capture",
      "window/set-auth-mode",
      "window/set-picker-mode",
      "theme/set",
      "preference/get",
      "preference/set",
      "feedback/submit",
      "shell/openExternal",
      "link/preview",
      "power/preventSleep",
      "folder/listIdes",
      "dialog/openFiles",
      "attachment/saveClipboardImage",
      "attachment/readPreview",
      "graft/auth/login",
      "graft/auth/logout",
      "graft/auth/status",
    ],
  },
  {
    policy: { owner: "split" },
    commands: ["turn/start", "files/import"],
  },
  {
    policy: { owner: "unsupported_remote" },
    commands: [
      "project/revealInFinder",
      "shell/reveal-in-finder",
      "shell/open-in-terminal",
      "folder/open",
      "skills/openFolder",
      "thread/export",
      "provider/oauth/start",
      "mcp/authenticate",
    ],
  },
] as const satisfies readonly PolicyDefinition[];

function createDesktopCommandPolicies(): Readonly<
  Record<DesktopCommandType, DesktopCommandPolicy>
> {
  const policies = new Map<DesktopCommandType, DesktopCommandPolicy>();
  for (const definition of POLICY_DEFINITIONS) {
    for (const commandType of definition.commands) {
      if (policies.has(commandType)) {
        throw new Error(`Duplicate desktop command policy: ${commandType}`);
      }
      const implementedCapability =
        GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES[
          commandType as keyof typeof GRAFT_DESKTOP_V1_HOST_COMMAND_CAPABILITIES
        ];
      const policy =
        definition.policy.owner === "host" &&
        implementedCapability !== definition.policy.capability
          ? ({ owner: "unsupported_remote" } as const)
          : definition.policy;
      policies.set(commandType, Object.freeze({ ...policy }));
    }
  }

  const commandDescriptors =
    DESKTOP_MESSAGE_CONTRACT_REGISTRY.descriptors.filter(
      (descriptor): descriptor is DesktopCommandDescriptor =>
        descriptor.kind === "command",
    );
  for (const descriptor of commandDescriptors) {
    if (descriptor.route.transport === "fixed") {
      if (policies.has(descriptor.type)) {
        throw new Error(
          `Fixed desktop command must not have an environment policy: ${descriptor.type}`,
        );
      }
      policies.set(descriptor.type, Object.freeze({ owner: "client" }));
      continue;
    }
    if (descriptor.route.transport !== "generic") {
      throw new Error(
        `Unsupported desktop command transport: ${descriptor.type}:${descriptor.route.transport}`,
      );
    }
    if (!policies.has(descriptor.type)) {
      throw new Error(`Missing desktop command policy: ${descriptor.type}`);
    }
  }

  if (policies.size !== commandDescriptors.length) {
    throw new Error(
      "Desktop command policies do not match the contract registry",
    );
  }

  return Object.freeze(Object.fromEntries(policies)) as Readonly<
    Record<DesktopCommandType, DesktopCommandPolicy>
  >;
}

export const DESKTOP_COMMAND_POLICIES = createDesktopCommandPolicies();

export type DesktopAuthorizationRejectionReason =
  | "unknown_command"
  | "wrong_profile"
  | "client_owned"
  | "split_command"
  | "unsupported_remote"
  | "host_unsupported"
  | "missing_grant"
  | "client_unsupported";

export type DesktopCommandAuthorization =
  | Readonly<{
      allowed: true;
      commandType: DesktopCommandType;
      policy: DesktopCommandPolicy & {
        owner: "host";
        capability: GraftDesktopCapability;
      };
    }>
  | Readonly<{
      allowed: false;
      commandType: string;
      reason: DesktopAuthorizationRejectionReason;
      policy?: DesktopCommandPolicy;
    }>;

export interface AuthorizeDesktopCommandInput {
  commandType: string;
  sessionProfile: string;
  hostCapabilities: readonly GraftDesktopCapability[];
  sessionGrants: readonly GraftDesktopCapability[];
  clientCapabilities: readonly GraftDesktopCapability[];
}

function commandPolicyForType(
  commandType: string,
): DesktopCommandPolicy | null {
  if (
    !Object.prototype.hasOwnProperty.call(DESKTOP_COMMAND_POLICIES, commandType)
  ) {
    return null;
  }
  return DESKTOP_COMMAND_POLICIES[commandType as DesktopCommandType];
}

export function authorizeDesktopCommand(
  input: AuthorizeDesktopCommandInput,
): DesktopCommandAuthorization {
  const policy = commandPolicyForType(input.commandType);
  if (!policy) {
    return {
      allowed: false,
      commandType: input.commandType,
      reason: "unknown_command",
    };
  }
  if (input.sessionProfile !== "desktop_occupancy") {
    return {
      allowed: false,
      commandType: input.commandType,
      reason: "wrong_profile",
      policy,
    };
  }

  switch (policy.owner) {
    case "client":
      return {
        allowed: false,
        commandType: input.commandType,
        reason: "client_owned",
        policy,
      };
    case "split":
      return {
        allowed: false,
        commandType: input.commandType,
        reason: "split_command",
        policy,
      };
    case "unsupported_remote":
      return {
        allowed: false,
        commandType: input.commandType,
        reason: "unsupported_remote",
        policy,
      };
    case "host": {
      const capability = policy.capability;
      if (!capability) {
        throw new Error(
          `Host command is missing a capability: ${input.commandType}`,
        );
      }
      if (!input.hostCapabilities.includes(capability)) {
        return {
          allowed: false,
          commandType: input.commandType,
          reason: "host_unsupported",
          policy,
        };
      }
      if (!input.sessionGrants.includes(capability)) {
        return {
          allowed: false,
          commandType: input.commandType,
          reason: "missing_grant",
          policy,
        };
      }
      if (!input.clientCapabilities.includes(capability)) {
        return {
          allowed: false,
          commandType: input.commandType,
          reason: "client_unsupported",
          policy,
        };
      }
      return {
        allowed: true,
        commandType: input.commandType as DesktopCommandType,
        policy: { owner: "host", capability },
      };
    }
    default: {
      const exhaustive: never = policy.owner;
      throw new Error(`Unknown desktop command owner: ${String(exhaustive)}`);
    }
  }
}
