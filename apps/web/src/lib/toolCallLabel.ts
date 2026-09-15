// FILE: toolCallLabel.ts
// Purpose: Normalizes generic tool-call titles and humanizes command executions for timeline rows.
// Layer: UI utility
// Exports: deriveReadableToolTitle, deriveReadableCommandDisplay, deriveFriendlyCommandTarget, command icon classifiers, deriveInlineCommandCall, normalizeCompactToolLabel, isGenericToolTitle, extractWebFetchUrl
// Depends on: @graft/contracts tool lifecycle item types

import type { ToolLifecycleItemType } from "@graft/contracts";
import { BROWSER_TOOL_TITLES } from "@graft/shared/browserAutomationPresentation";
import { basenameOfPath } from "../file-icons";
import { extractToolArgumentField } from "./toolArgumentSummary";

export function normalizeCompactToolLabel(value: string): string {
  return value
    .trimEnd()
    .replace(/\s(?:complete|completed|done|finished|success|succeeded|started|running)$/i, "")
    .trim();
}

// Canonical form for comparing tool display strings (heading vs preview vs
// label): ignores case, whitespace runs, and trailing status words so dedup
// decisions behave identically in the work-log builder and the timeline rows.
export function normalizeToolTextForComparison(value: string | undefined): string {
  return normalizeCompactToolLabel(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Web-fetch tool calls (e.g. Claude's `WebFetch`) arrive as generic dynamic tool
// calls whose detail is the raw `ToolName: {json}` argument summary. Recognizing
// them lets the timeline surface the target site (favicon + URL) instead of the
// raw JSON arguments.
const WEB_FETCH_TOOL_NAMES = new Set(["webfetch", "fetch", "urlfetch", "fetchurl", "httpfetch"]);

function isWebFetchToolName(toolName: string | null | undefined): boolean {
  if (!toolName) {
    return false;
  }
  const normalized = toolName.toLowerCase().replace(/[^a-z]/g, "");
  if (WEB_FETCH_TOOL_NAMES.has(normalized)) {
    return true;
  }
  return (
    normalized.includes("fetch") &&
    (normalized.includes("web") || normalized.includes("url") || normalized.includes("http"))
  );
}

// Pulls the first http(s) URL out of a web-fetch tool call's argument summary.
// Prefers the JSON `url`/`uri` field (the actual shape) and falls back to a bare
// URL token so a slightly different summary still resolves. Returns null for
// non-fetch tools or when no usable URL is present, so callers fall back to the
// generic tool-call rendering.
export function extractWebFetchUrl(input: {
  readonly toolName?: string | null | undefined;
  readonly detail?: string | null | undefined;
}): string | null {
  if (!isWebFetchToolName(input.toolName)) {
    return null;
  }
  const detail = input.detail;
  if (!detail) {
    return null;
  }
  const candidate =
    extractToolArgumentField(detail, ["url", "uri"]) ??
    /https?:\/\/[^\s"'<>)\]}]+/i.exec(detail)?.[0]?.replace(/[.,;:!?]+$/, "");
  if (candidate && /^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return null;
}

// Turns internal MCP identifiers into readable inline labels for timeline rows.
function humanizeMcpToolIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("mcp__")) {
    return null;
  }

  const [, server, tool, ...rest] = trimmed.split("__");
  const normalizedServer = humanizeMcpToken(server);
  const normalizedTool = [tool, ...rest]
    .map((part) => humanizeMcpToken(part))
    .filter((part) => part.length > 0)
    .join(" ");

  if (!normalizedServer || !normalizedTool) {
    return null;
  }
  return `${normalizedServer}: ${normalizedTool}`;
}

function humanizeMcpServerTool(server: string, tool: string): string | null {
  const normalizedServer = humanizeMcpToken(server);
  const normalizedTool = humanizeMcpToken(tool);
  if (!normalizedServer || !normalizedTool) {
    return null;
  }
  return `${normalizedServer}: ${normalizedTool}`;
}

export interface ReadableToolTitleInput {
  readonly title?: string | null;
  readonly fallbackLabel: string;
  readonly itemType?: ToolLifecycleItemType | undefined;
  readonly requestKind?: "command" | "file-read" | "file-change" | "permissions" | undefined;
  readonly command?: string | null;
  readonly payload?: Record<string, unknown> | null;
  readonly isRunning?: boolean;
}

interface GraftMcpToolPresentation {
  readonly running: string;
  readonly completed: string;
  readonly failed: string;
}

// Historical messages still contain retired tools; presentation does not expose them to agents.
const BROWSER_HISTORY_TITLES = {
  ...BROWSER_TOOL_TITLES,
  browser_snapshot: "Snapshot browser page",
  browser_webmcp_tools: "Discover page WebMCP tools",
  browser_webmcp_call: "Call page WebMCP tool",
  browser_click: "Click browser target",
  browser_hover: "Hover browser target",
  browser_drag: "Drag between browser targets",
  browser_type: "Type into browser target",
  browser_select: "Select browser options",
  browser_press: "Press browser keys",
  browser_scroll: "Scroll browser page",
  browser_wait: "Wait for browser condition",
  browser_evaluate: "Evaluate browser expression",
} as const;
type BrowserHistoryToolName = keyof typeof BROWSER_HISTORY_TITLES;
type GraftBrowserToolName = `graft_${BrowserHistoryToolName}`;
const BROWSER_HISTORY_TOOL_NAMES = Object.keys(BROWSER_HISTORY_TITLES) as BrowserHistoryToolName[];
const BROWSER_TOOL_NAME_SET = new Set<string>(BROWSER_HISTORY_TOOL_NAMES);

const GRAFT_BROWSER_TOOL_PRESENTATIONS = Object.fromEntries(
  BROWSER_HISTORY_TOOL_NAMES.map((toolName) => {
    const title = BROWSER_HISTORY_TITLES[toolName];
    return [`graft_${toolName}`, { running: title, completed: title, failed: title }];
  }),
) as Record<GraftBrowserToolName, GraftMcpToolPresentation>;

const GRAFT_MCP_TOOL_PRESENTATIONS = {
  graft_context: {
    running: "Graft is checking its context",
    completed: "Graft checked its context",
    failed: "Graft couldn't check its context",
  },
  graft_capabilities: {
    running: "Graft is checking available agents",
    completed: "Graft checked available agents",
    failed: "Graft couldn't check available agents",
  },
  graft_overview: {
    running: "Graft is gathering an overview",
    completed: "Graft gathered an overview",
    failed: "Graft couldn't gather an overview",
  },
  graft_list_allowed_projects: {
    running: "Graft is listing allowed projects",
    completed: "Graft listed allowed projects",
    failed: "Graft couldn't list allowed projects",
  },
  graft_create_task: {
    running: "Graft is creating a task",
    completed: "Graft created a task",
    failed: "Graft couldn't create a task",
  },
  graft_wait_for_task: {
    running: "Graft is waiting for a task",
    completed: "Graft finished waiting for a task",
    failed: "Graft couldn't wait for a task",
  },
  graft_read_task: {
    running: "Graft is reading a task",
    completed: "Graft read a task",
    failed: "Graft couldn't read a task",
  },
  graft_list_projects: {
    running: "Graft is listing projects",
    completed: "Graft listed projects",
    failed: "Graft couldn't list projects",
  },
  graft_list_threads: {
    running: "Graft is listing threads",
    completed: "Graft listed threads",
    failed: "Graft couldn't list threads",
  },
  graft_read_thread: {
    running: "Graft is reading a thread",
    completed: "Graft read a thread",
    failed: "Graft couldn't read a thread",
  },
  graft_read_thread_activity: {
    running: "Graft is reading thread activity",
    completed: "Graft read thread activity",
    failed: "Graft couldn't read thread activity",
  },
  graft_read_thread_events: {
    running: "Graft is reading thread events",
    completed: "Graft read thread events",
    failed: "Graft couldn't read thread events",
  },
  graft_read_thread_runtime_events: {
    running: "Graft is reading thread runtime events",
    completed: "Graft read thread runtime events",
    failed: "Graft couldn't read thread runtime events",
  },
  graft_diagnose_thread: {
    running: "Graft is diagnosing a thread",
    completed: "Graft diagnosed a thread",
    failed: "Graft couldn't diagnose a thread",
  },
  graft_create_thread: {
    running: "Graft is creating a thread",
    completed: "Graft created a thread",
    failed: "Graft couldn't create a thread",
  },
  graft_create_threads: {
    running: "Graft is creating threads",
    completed: "Graft created threads",
    failed: "Graft couldn't create threads",
  },
  graft_wait_for_threads: {
    running: "Graft is waiting for threads",
    completed: "Graft finished waiting for threads",
    failed: "Graft couldn't wait for threads",
  },
  graft_send_message: {
    running: "Graft is sending a message",
    completed: "Graft sent a message",
    failed: "Graft couldn't send a message",
  },
  graft_interrupt_thread: {
    running: "Graft is interrupting a thread",
    completed: "Graft interrupted a thread",
    failed: "Graft couldn't interrupt a thread",
  },
  graft_set_thread_title: {
    running: "Graft is renaming a thread",
    completed: "Graft renamed a thread",
    failed: "Graft couldn't rename a thread",
  },
  graft_set_thread_archived: {
    running: "Graft is updating a thread",
    completed: "Graft updated a thread",
    failed: "Graft couldn't update a thread",
  },
  graft_create_automation: {
    running: "Graft is creating an automation",
    completed: "Graft created an automation",
    failed: "Graft couldn't create an automation",
  },
  graft_list_automations: {
    running: "Graft is listing automations",
    completed: "Graft listed automations",
    failed: "Graft couldn't list automations",
  },
  graft_view_automation: {
    running: "Graft is viewing an automation",
    completed: "Graft viewed an automation",
    failed: "Graft couldn't view an automation",
  },
  graft_update_automation: {
    running: "Graft is updating an automation",
    completed: "Graft updated an automation",
    failed: "Graft couldn't update an automation",
  },
  graft_update_automation_memory: {
    running: "Graft is updating automation memory",
    completed: "Graft updated automation memory",
    failed: "Graft couldn't update automation memory",
  },
  graft_report_automation_result: {
    running: "Graft is reporting an automation result",
    completed: "Graft reported an automation result",
    failed: "Graft couldn't report an automation result",
  },
  graft_cancel_automation: {
    running: "Graft is stopping an automation",
    completed: "Graft stopped an automation",
    failed: "Graft couldn't stop an automation",
  },
  ...GRAFT_BROWSER_TOOL_PRESENTATIONS,
} as const satisfies Record<string, GraftMcpToolPresentation>;

function normalizeGraftMcpIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const GRAFT_BROWSER_TOOL_NAME_BY_PRESENTATION = new Map<string, GraftBrowserToolName>(
  BROWSER_HISTORY_TOOL_NAMES.map((toolName) => [
    normalizeGraftMcpIdentifier(BROWSER_HISTORY_TITLES[toolName]),
    `graft_${toolName}`,
  ]),
);

const GRAFT_MCP_TOOL_PRESENTATION_ENTRIES = Object.entries(GRAFT_MCP_TOOL_PRESENTATIONS).map(
  ([toolName, presentation]) => ({
    toolName,
    presentation,
    normalizedRunning: normalizeGraftMcpIdentifier(presentation.running),
    normalizedCompleted: normalizeGraftMcpIdentifier(presentation.completed),
    normalizedFailed: normalizeGraftMcpIdentifier(presentation.failed),
  }),
);

function extractGraftMcpToolName(normalizedCandidate: string): string | null {
  if (BROWSER_TOOL_NAME_SET.has(normalizedCandidate)) {
    return `graft_${normalizedCandidate}`;
  }
  if (normalizedCandidate.startsWith("mcp_graft_graft_")) {
    return normalizedCandidate.slice("mcp_graft_".length);
  }
  if (normalizedCandidate.startsWith("mcp_graft_")) {
    return `graft_${normalizedCandidate.slice("mcp_graft_".length)}`;
  }
  if (normalizedCandidate.startsWith("mcp_synara_synara_")) {
    return `graft_${normalizedCandidate.slice("mcp_synara_synara_".length)}`;
  }
  if (normalizedCandidate.startsWith("mcp_synara_")) {
    return `graft_${normalizedCandidate.slice("mcp_synara_".length)}`;
  }
  if (normalizedCandidate.startsWith("graft_graft_")) {
    return normalizedCandidate.slice("graft_".length);
  }
  if (normalizedCandidate.startsWith("graft_")) {
    return normalizedCandidate;
  }
  if (normalizedCandidate.startsWith("synara_synara_")) {
    return `graft_${normalizedCandidate.slice("synara_synara_".length)}`;
  }
  if (normalizedCandidate.startsWith("synara_")) {
    return `graft_${normalizedCandidate.slice("synara_".length)}`;
  }
  return null;
}

function resolveGraftBrowserToolName(
  candidates: ReadonlyArray<string | null | undefined>,
): GraftBrowserToolName | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalizedCandidate = normalizeGraftMcpIdentifier(candidate);
    const extractedToolName = extractGraftMcpToolName(normalizedCandidate);
    const candidateToolName =
      extractedToolName ??
      GRAFT_BROWSER_TOOL_NAME_BY_PRESENTATION.get(normalizedCandidate) ??
      normalizedCandidate;
    if (candidateToolName in GRAFT_BROWSER_TOOL_PRESENTATIONS) {
      return candidateToolName as GraftBrowserToolName;
    }
  }
  return null;
}

function fallbackGraftMcpToolPresentation(toolName: string): GraftMcpToolPresentation {
  const action =
    toolName
      .replace(/^graft_/, "")
      .replace(/_+/g, " ")
      .trim() || "an action";
  return {
    running: `Graft is handling ${action}`,
    completed: `Graft handled ${action}`,
    failed: `Graft couldn't handle ${action}`,
  };
}

function resolveGraftMcpToolPresentation(
  candidates: ReadonlyArray<string | null | undefined>,
): GraftMcpToolPresentation | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalizedCandidate = normalizeGraftMcpIdentifier(candidate);
    for (const entry of GRAFT_MCP_TOOL_PRESENTATION_ENTRIES) {
      if (
        normalizedCandidate === entry.normalizedRunning ||
        normalizedCandidate === entry.normalizedCompleted ||
        normalizedCandidate === entry.normalizedFailed
      ) {
        return entry.presentation;
      }
    }
    const toolName = extractGraftMcpToolName(normalizedCandidate);
    const knownPresentation = toolName
      ? (GRAFT_MCP_TOOL_PRESENTATIONS[toolName as keyof typeof GRAFT_MCP_TOOL_PRESENTATIONS] as
          | GraftMcpToolPresentation
          | undefined)
      : undefined;
    if (knownPresentation) {
      return knownPresentation;
    }
    // Free-text summaries (e.g. reconciler activity lines) can begin with the
    // word "Graft" and normalize into a fake tool identifier; only
    // identifier-shaped candidates may take an invented fallback presentation.
    if (/\s/.test(candidate.trim())) {
      continue;
    }
    if (normalizedCandidate.startsWith("graft_is_handling_")) {
      return fallbackGraftMcpToolPresentation(
        `graft_${normalizedCandidate.slice("graft_is_handling_".length)}`,
      );
    }
    if (normalizedCandidate.startsWith("graft_handled_")) {
      return fallbackGraftMcpToolPresentation(
        `graft_${normalizedCandidate.slice("graft_handled_".length)}`,
      );
    }
    if (normalizedCandidate.startsWith("graft_couldn_t_handle_")) {
      return fallbackGraftMcpToolPresentation(
        `graft_${normalizedCandidate.slice("graft_couldn_t_handle_".length)}`,
      );
    }
    if (!toolName) {
      continue;
    }
    return fallbackGraftMcpToolPresentation(toolName);
  }
  return null;
}

export type GraftMcpToolStatus = "running" | "completed" | "failed" | "cancelled";

export interface GraftMcpToolTitleInput {
  readonly toolName?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly fallbackLabel?: string | null | undefined;
  readonly status?: GraftMcpToolStatus | undefined;
}

export function isGraftBrowserToolCall(input: GraftMcpToolTitleInput): boolean {
  return resolveGraftBrowserToolName([input.toolName, input.title, input.fallbackLabel]) !== null;
}

// Every provider exposes Graft's MCP tools differently: MCP, dynamic, and even
// file-change rows can all represent the same gateway action. Normalize by tool
// identity instead of provider item type so transport details never reach the UI.
export function deriveGraftMcpToolTitle(input: GraftMcpToolTitleInput): string | null {
  const presentation = resolveGraftMcpToolPresentation([
    input.toolName,
    input.title,
    input.fallbackLabel,
  ]);
  if (!presentation) {
    return null;
  }
  switch (input.status ?? "completed") {
    case "running":
      return presentation.running;
    case "completed":
      return presentation.completed;
    case "failed":
      return presentation.failed;
    case "cancelled":
      return presentation.running.startsWith("Graft is ")
        ? `Graft stopped ${presentation.running.slice("Graft is ".length)}`
        : `Cancelled ${presentation.running}`;
  }
}

export function sanitizeGraftMcpToolPreview(input: {
  readonly preview?: string | null | undefined;
  readonly heading: string;
  readonly status?: GraftMcpToolStatus | undefined;
}): string | null {
  const preview = input.preview?.trim();
  if (!preview) return null;
  const previewTitle = deriveGraftMcpToolTitle({ title: preview, status: input.status });
  if (
    previewTitle &&
    normalizeGraftMcpIdentifier(previewTitle) === normalizeGraftMcpIdentifier(input.heading)
  ) {
    return null;
  }
  return preview;
}

export function deriveReadableToolTitle(input: ReadableToolTitleInput): string | null {
  const normalizedTitle = normalizeCompactToolLabel(input.title ?? "");
  const normalizedFallback = normalizeCompactToolLabel(input.fallbackLabel);
  const commandLabel = input.command
    ? deriveReadableCommandDisplay(input.command, input.isRunning).verb
    : null;
  const commandLike = input.itemType === "command_execution" || input.requestKind === "command";

  // Derive a verbal label from requestKind when the title is generic
  const requestKindLabel = humanizeRequestKind(input.requestKind, input.itemType);

  if (normalizedTitle.length > 0 && !isGenericToolTitle(normalizedTitle)) {
    return normalizedTitle;
  }

  // Use verbal requestKind label before falling back to raw descriptors
  if (requestKindLabel) {
    return requestKindLabel;
  }

  if (commandLike && commandLabel) {
    return commandLabel;
  }

  const descriptor = normalizeToolDescriptor(extractToolDescriptorFromPayload(input.payload));
  if (descriptor && !isGenericToolTitle(descriptor)) {
    return descriptor;
  }

  if (normalizedFallback.length > 0 && !isGenericToolTitle(normalizedFallback)) {
    return normalizedFallback;
  }
  if (normalizedTitle.length > 0) {
    return normalizedTitle;
  }
  if (normalizedFallback.length > 0) {
    return normalizedFallback;
  }
  return null;
}

export interface ReadableCommandDisplay {
  readonly verb: string;
  readonly target: string;
  readonly fullCommand: string;
}

export type CommandVisualKind = "inspect" | "git" | "github" | "terminal";

function humanizeRequestKind(
  requestKind: ReadableToolTitleInput["requestKind"],
  itemType: ReadableToolTitleInput["itemType"],
): string | null {
  if (requestKind === "file-read") return "Read";
  if (requestKind === "file-change" || itemType === "file_change") return "Edited";
  // Don't handle command types here — let humanizeCommandToolLabel produce more specific labels
  if (itemType === "web_search") return "Searched the web";
  if (itemType === "image_generation") return "Generated image";
  if (itemType === "image_view") return "Viewed image";
  if (itemType === "collab_agent_tool_call") return "Agent task";
  return null;
}

export function isGenericToolTitle(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    normalized === "tool" ||
    normalized === "tool call" ||
    normalized === "dynamic tool call" ||
    normalized === "mcp tool call" ||
    normalized === "agent task" ||
    normalized === "subagent task" ||
    normalized === "task" ||
    normalized === "command run" ||
    normalized === "ran command" ||
    normalized === "running command" ||
    normalized === "command execution" ||
    normalized === "file change" ||
    normalized === "find" ||
    normalized === "read file"
  );
}

function normalizeToolDescriptor(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const mcpIdentifier = humanizeMcpToolIdentifier(value);
  if (mcpIdentifier) {
    return mcpIdentifier;
  }
  const normalized = value.replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  const dedupedTokens: string[] = [];
  for (const token of normalized.split(" ")) {
    if (dedupedTokens.at(-1)?.toLowerCase() === token.toLowerCase()) {
      continue;
    }
    dedupedTokens.push(token);
  }
  const collapsed = dedupedTokens.join(" ").trim();
  if (!collapsed) {
    return null;
  }
  const lowerCollapsed = collapsed.toLowerCase();
  if (lowerCollapsed === "read") {
    return "Read";
  }
  if (lowerCollapsed === "search" || lowerCollapsed === "find" || lowerCollapsed === "searched") {
    return "Search";
  }
  return collapsed.length > 64 ? `${collapsed.slice(0, 61).trimEnd()}...` : collapsed;
}

function humanizeMcpToken(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .map((token) => {
      const lower = token.toLowerCase();
      if (lower === "mcp") return "MCP";
      if (token.toUpperCase() === token && token.length <= 5) return token;
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function extractToolDescriptorFromPayload(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  if (!payload) {
    return null;
  }
  const mcpServerTool = extractMcpServerToolDescriptor(payload, 0);
  if (mcpServerTool) {
    return mcpServerTool;
  }
  const descriptorKeys = ["kind", "name", "tool", "tool_name", "toolName", "title"];
  const candidates: string[] = [];
  collectDescriptorCandidates(payload, descriptorKeys, candidates, 0);
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized) {
      continue;
    }
    if (isGenericToolTitle(normalizeCompactToolLabel(normalized))) {
      continue;
    }
    return normalized;
  }
  return null;
}

function extractMcpServerToolDescriptor(value: unknown, depth: number): string | null {
  if (depth > 4 || !value || typeof value !== "object") {
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractMcpServerToolDescriptor(entry, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.server === "string" && typeof record.tool === "string") {
    return humanizeMcpServerTool(record.server, record.tool);
  }
  for (const nestedKey of ["item", "data", "event", "payload", "result", "input", "call"]) {
    const nested = extractMcpServerToolDescriptor(record[nestedKey], depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function collectDescriptorCandidates(
  value: unknown,
  keys: ReadonlyArray<string>,
  target: string[],
  depth: number,
) {
  if (depth > 4 || target.length >= 24) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      target.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDescriptorCandidates(entry, keys, target, depth + 1);
      if (target.length >= 24) {
        return;
      }
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string") {
      const trimmed = (record[key] as string).trim();
      if (trimmed) {
        target.push(trimmed);
      }
    }
  }
  for (const nestedKey of ["item", "data", "event", "payload", "result", "input", "tool", "call"]) {
    if (nestedKey in record) {
      collectDescriptorCandidates(record[nestedKey], keys, target, depth + 1);
      if (target.length >= 24) {
        return;
      }
    }
  }
}

// Read-only inspection commands surfaced with the search/magnifying-glass icon in
// the timeline (reads, searches, finds, listings), as opposed to commands that
// mutate or execute, which keep the terminal icon. These sets are the single
// source of truth for both the command labels below and the icon decision.
const READ_FILE_COMMAND_TOOLS = new Set(["cat", "nl", "head", "tail", "sed", "less", "more"]);
const SEARCH_COMMAND_TOOLS = new Set(["rg", "grep", "ag", "ack"]);
const FIND_COMMAND_TOOLS = new Set(["find", "fd"]);
const LIST_COMMAND_TOOLS = new Set(["ls"]);

function isInspectCommandTool(tool: string): boolean {
  return (
    READ_FILE_COMMAND_TOOLS.has(tool) ||
    SEARCH_COMMAND_TOOLS.has(tool) ||
    FIND_COMMAND_TOOLS.has(tool) ||
    LIST_COMMAND_TOOLS.has(tool)
  );
}

// Derives the compact command sentence shown inline while preserving the full command for hover/detail UI.
export function deriveReadableCommandDisplay(
  rawCommand: string,
  isRunning = false,
): ReadableCommandDisplay {
  const command = stripCommandDisplayWrappers(unwrapShellCommandIfPresent(rawCommand));
  const primaryCommand = firstShellCommandSegment(command);
  const [tool, args] = splitToolAndArgs(primaryCommand);

  if (READ_FILE_COMMAND_TOOLS.has(tool)) {
    return {
      verb: isRunning ? "Reading" : "Read",
      target: lastPathComponents(args, "file"),
      fullCommand: rawCommand,
    };
  }
  if (SEARCH_COMMAND_TOOLS.has(tool)) {
    return {
      verb: isRunning ? "Searching" : "Searched",
      target: searchSummary(args),
      fullCommand: rawCommand,
    };
  }
  if (LIST_COMMAND_TOOLS.has(tool)) {
    return {
      verb: isRunning ? "Listing" : "Listed",
      target: lastPathComponents(args, "directory"),
      fullCommand: rawCommand,
    };
  }
  if (FIND_COMMAND_TOOLS.has(tool)) {
    return {
      verb: isRunning ? "Finding" : "Found",
      target: findTarget(args, "files"),
      fullCommand: rawCommand,
    };
  }

  switch (tool) {
    case "mkdir":
      return {
        verb: isRunning ? "Creating" : "Created",
        target: lastPathComponents(args, "directory"),
        fullCommand: rawCommand,
      };
    case "rm":
      return {
        verb: isRunning ? "Removing" : "Removed",
        target: lastPathComponents(args, "file"),
        fullCommand: rawCommand,
      };
    case "cp":
    case "mv":
      return {
        verb: isRunning
          ? tool === "cp"
            ? "Copying"
            : "Moving"
          : tool === "cp"
            ? "Copied"
            : "Moved",
        target: lastPathComponents(args, "file"),
        fullCommand: rawCommand,
      };
    case "git":
      return humanizeGitCommand(args, rawCommand, isRunning);
    case "node":
    case "bun":
    case "deno":
    case "python":
    case "python3":
    case "ruby":
    case "perl":
      return {
        verb: isRunning ? "Running" : "Ran",
        target: inlineScriptTarget(tool, command, args) ?? compactInlineCommand(command),
        fullCommand: rawCommand,
      };
    case "osascript":
      return {
        verb: isRunning ? "Running" : "Ran",
        target: "AppleScript",
        fullCommand: rawCommand,
      };
    default:
      return {
        verb: isRunning ? "Running" : "Ran",
        target: compactInlineCommand(command),
        fullCommand: rawCommand,
      };
  }
}

function firstCommandExecutable(rawCommand: string): string {
  const trimmed = rawCommand.trim();
  const match = /^(?:"([^"]+)"|'([^']+)'|(\S+))/u.exec(trimmed);
  const executable = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  return executable.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
}

// The object half of a command row's sentence ("Searched <for foo in src>"),
// kept short enough to read inline. Shell wrappers that carry no meaning for a
// human (a full pwsh.exe path) collapse to the shell's friendly name.
export function deriveFriendlyCommandTarget(rawCommand: string): string {
  const executable = firstCommandExecutable(rawCommand);
  if (
    executable === "pwsh" ||
    executable === "pwsh.exe" ||
    executable === "powershell" ||
    executable === "powershell.exe"
  ) {
    return "PowerShell";
  }
  if (executable === "cmd" || executable === "cmd.exe") {
    return "Command Prompt";
  }

  const target = deriveReadableCommandDisplay(rawCommand).target.trim();
  return target.length <= 72 ? target : `${target.slice(0, 69).trimEnd()}…`;
}

// Classifies command rows for transcript glyphs after peeling away shell/env wrappers.
// This keeps `git -C`, `env ... gh`, and `/bin/zsh -lc "cd ... && git ..."` visually branded.
export function resolveCommandVisualKind(rawCommand: string): CommandVisualKind {
  const command = stripCommandDisplayWrappers(unwrapShellCommandIfPresent(rawCommand));
  const [tool] = splitToolAndArgs(firstShellCommandSegment(command));
  if (isInspectCommandTool(tool)) {
    return "inspect";
  }
  if (tool === "git") {
    return "git";
  }
  if (tool === "gh" || tool === "hub") {
    return "github";
  }
  return "terminal";
}

export function deriveInlineCommandCall(rawCommand: string): string {
  return stripCommandDisplayWrappers(unwrapShellCommandIfPresent(rawCommand));
}

function humanizeGitCommand(
  args: string,
  rawCommand: string,
  isRunning: boolean,
): ReadableCommandDisplay {
  const normalizedArgs = stripGitGlobalOptions(args);
  const subcommand = normalizedArgs.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  switch (subcommand) {
    case "status":
      return {
        verb: isRunning ? "Checking" : "Checked",
        target: "git status",
        fullCommand: rawCommand,
      };
    case "diff":
      return {
        verb: isRunning ? "Comparing" : "Compared",
        target: "changes",
        fullCommand: rawCommand,
      };
    case "show":
      return {
        verb: isRunning ? "Inspecting" : "Inspected",
        target: "commit",
        fullCommand: rawCommand,
      };
    case "log":
      return {
        verb: isRunning ? "Reviewing" : "Reviewed",
        target: "git history",
        fullCommand: rawCommand,
      };
    case "add":
      return {
        verb: isRunning ? "Staging" : "Staged",
        target: "changes",
        fullCommand: rawCommand,
      };
    case "commit":
      return {
        verb: isRunning ? "Committing" : "Committed",
        target: "changes",
        fullCommand: rawCommand,
      };
    case "push":
      return {
        verb: isRunning ? "Pushing" : "Pushed",
        target: "to remote",
        fullCommand: rawCommand,
      };
    case "pull":
      return {
        verb: isRunning ? "Pulling" : "Pulled",
        target: "from remote",
        fullCommand: rawCommand,
      };
    case "checkout":
    case "switch":
      return {
        verb: isRunning ? "Switching to" : "Switched to",
        target: checkoutTarget(args),
        fullCommand: rawCommand,
      };
    default:
      return {
        verb: isRunning ? "Running" : "Ran",
        target: compactInlineCommand(`git ${normalizedArgs}`.trim()),
        fullCommand: rawCommand,
      };
  }
}

function stripGitGlobalOptions(args: string): string {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === "-C" || token === "-c" || token === "--git-dir" || token === "--work-tree") {
      index += 2;
      continue;
    }
    if (
      token.startsWith("-C") ||
      token.startsWith("-c") ||
      token.startsWith("--git-dir=") ||
      token.startsWith("--work-tree=")
    ) {
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      index += 1;
      continue;
    }
    break;
  }
  return tokens.slice(index).join(" ");
}

function checkoutTarget(args: string): string {
  const branch = tokenizeCommandArgs(args).at(-1)?.trim();
  return branch ? branch : "branch";
}

function lastPathComponents(args: string, fallback: string): string {
  const tokens = tokenizeCommandArgs(args);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!.replace(/^['"]|['"]$/g, "");
    if (!token || token.startsWith("-")) {
      continue;
    }
    return compactPath(token);
  }
  return fallback;
}

function findTarget(args: string, fallback: string): string {
  const tokens = tokenizeCommandArgs(args);
  let skipNext = false;
  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token.startsWith("-")) {
      if (
        token === "-maxdepth" ||
        token === "-mindepth" ||
        token === "-name" ||
        token === "-type" ||
        token === "-path"
      ) {
        skipNext = true;
      }
      continue;
    }
    return compactPath(token);
  }
  return fallback;
}

function compactPath(path: string): string {
  if (path === ".") {
    return "current directory";
  }
  if (path === "..") {
    return "parent directory";
  }
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) {
    return path;
  }
  return parts.slice(-2).join("/");
}

function compactInlineCommand(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  if (normalized.length <= 140) {
    return normalized;
  }
  return `${normalized.slice(0, 137).trimEnd()}...`;
}

function firstShellCommandSegment(command: string): string {
  const chain = findShellChain(command);
  return chain ? command.slice(0, chain.operatorStart).trim() : command;
}

function inlineScriptTarget(tool: string, command: string, args: string): string | null {
  const normalizedTool = tool === "python3" ? "python" : tool;
  if (containsHeredoc(command) || hasInlineScriptFlag(args)) {
    return `${normalizedTool} script`;
  }
  return null;
}

function containsHeredoc(command: string): boolean {
  return /(^|\s)<<-?\s*['"]?[A-Za-z0-9_]+/.test(command);
}

function hasInlineScriptFlag(args: string): boolean {
  const tokens = tokenizeCommandArgs(args);
  return tokens.some((token) => token === "-e" || token === "-c" || token.startsWith("-e="));
}

function searchSummary(args: string): string {
  const { pattern, path } = extractSearchPatternAndPath(args);
  if (pattern && path) {
    return `for ${pattern} in ${path}`;
  }
  if (pattern) {
    return `for ${pattern}`;
  }
  if (path) {
    return `in ${path}`;
  }
  return "files";
}

function extractSearchPatternAndPath(args: string): {
  pattern: string | null;
  path: string | null;
} {
  const tokens = tokenizeCommandArgs(args);
  let pattern: string | null = null;
  let path: string | null = null;
  let skipNext = false;

  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (token.startsWith("-")) {
      if (
        token === "-t" ||
        token === "-g" ||
        token === "--type" ||
        token === "--glob" ||
        token === "--max-count"
      ) {
        skipNext = true;
      }
      continue;
    }
    if (!pattern) {
      const normalizedPattern = normalizeSearchPatternToken(token);
      if (!normalizedPattern) {
        const normalizedPath = normalizeSearchPathToken(token);
        if (normalizedPath && (!path || path === "current directory")) {
          path = normalizedPath;
        }
        continue;
      }
      pattern = normalizedPattern;
      continue;
    }
    if (!path || path === "current directory") {
      path = normalizeSearchPathToken(token) ?? path;
      continue;
    }
  }

  if (pattern && path === "current directory" && looksLikeSearchPath(pattern)) {
    path = normalizeSearchPathToken(pattern);
    pattern = null;
  }

  return { pattern, path };
}

function normalizeSearchPatternToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return null;
  }
  if (!/[a-z0-9]/i.test(trimmed)) {
    return null;
  }
  return trimmed.length > 30 ? `${trimmed.slice(0, 27)}...` : trimmed;
}

function normalizeSearchPathToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  return compactPath(trimmed);
}

function looksLikeSearchPath(token: string): boolean {
  return token.includes("/") || token.startsWith(".") || token.includes("\\");
}

function tokenizeCommandArgs(args: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < args.length) {
    while (args[index] === " ") {
      index += 1;
    }
    if (index >= args.length) {
      break;
    }

    const quote = args[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      let token = "";
      while (index < args.length && args[index] !== quote) {
        if (args[index] === "\\" && index + 1 < args.length) {
          token += args[index + 1];
          index += 2;
          continue;
        }
        token += args[index];
        index += 1;
      }
      if (args[index] === quote) {
        index += 1;
      }
      tokens.push(token);
      continue;
    }

    let token = "";
    while (index < args.length && args[index] !== " ") {
      token += args[index];
      index += 1;
    }
    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

function splitToolAndArgs(command: string): [tool: string, args: string] {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return ["", ""];
  }
  const separator = normalized.indexOf(" ");
  if (separator === -1) {
    return [basenameOfPath(normalized).toLowerCase(), ""];
  }
  const tool = basenameOfPath(normalized.slice(0, separator)).toLowerCase();
  const args = normalized.slice(separator + 1).trim();
  return [tool, args];
}

function unwrapShellCommandIfPresent(rawCommand: string): string {
  let value = rawCommand.trim();
  if (!value) {
    return value;
  }

  const shellPrefixes = [
    "/usr/bin/bash -lc ",
    "/usr/bin/bash -c ",
    "/bin/bash -lc ",
    "/bin/bash -c ",
    "/usr/bin/zsh -lc ",
    "/usr/bin/zsh -c ",
    "/bin/zsh -lc ",
    "/bin/zsh -c ",
    "/bin/sh -lc ",
    "/bin/sh -c ",
    "bash -lc ",
    "bash -c ",
    "zsh -lc ",
    "zsh -c ",
    "sh -lc ",
    "sh -c ",
  ];

  const lowered = value.toLowerCase();
  for (const prefix of shellPrefixes) {
    if (!lowered.startsWith(prefix)) {
      continue;
    }
    value = value.slice(prefix.length).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1).trim();
    }
    value = stripLeadingShellPreambles(value);
    break;
  }

  const pipeIndex = value.indexOf("|");
  if (pipeIndex > 0) {
    value = value.slice(0, pipeIndex).trim();
  }

  return value;
}

function stripLeadingShellPreambles(value: string): string {
  let current = value.trim();
  for (let attempts = 0; attempts < 4; attempts += 1) {
    const chain = findShellChain(current);
    if (!chain) {
      return current;
    }
    const head = current.slice(0, chain.operatorStart).trim();
    if (!isShellSetupPreamble(head)) {
      return current;
    }
    current = current.slice(chain.commandStart).trim();
  }
  return current;
}

function isShellSetupPreamble(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  if (/^(?:builtin\s+)?cd\s+/.test(normalized)) {
    return true;
  }
  if (/^(?:source|\.)\s+/.test(normalized)) {
    return true;
  }
  if (/^set\s+[-+][A-Za-z]/.test(normalized)) {
    return true;
  }
  if (
    /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=[^\s]+(?:\s+[A-Za-z_][A-Za-z0-9_]*=[^\s]+)*$/.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

function findShellChain(value: string): { operatorStart: number; commandStart: number } | null {
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < value.length - 1; index += 1) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    const next = value[index + 1];
    if (char === "&" && next === "&") {
      return { operatorStart: index, commandStart: index + 2 };
    }
    if (char === ";") {
      return { operatorStart: index, commandStart: index + 1 };
    }
  }

  return null;
}

function stripCommandDisplayWrappers(command: string): string {
  let current = command.replace(/\s+/g, " ").trim();
  for (let attempts = 0; attempts < 4; attempts += 1) {
    const [tool, args] = splitToolAndArgs(current);
    const next =
      tool === "env"
        ? stripEnvCommand(args)
        : tool === "timeout" || tool === "gtimeout"
          ? stripTimeoutCommand(args)
          : tool === "nice"
            ? stripNiceCommand(args)
            : tool === "arch"
              ? stripArchCommand(args)
              : tool === "command"
                ? args
                : null;
    if (!next || next === current) {
      return current;
    }
    current = next.trim();
  }
  return current;
}

function stripEnvCommand(args: string): string | null {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token === "--") {
      index += 1;
      break;
    }
    if (token === "-u" || token === "--unset" || token === "-C" || token === "--chdir") {
      index += 2;
      continue;
    }
    if (token.startsWith("--unset=") || token.startsWith("--chdir=")) {
      index += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    break;
  }
  return index < tokens.length ? tokens.slice(index).join(" ") : null;
}

function stripTimeoutCommand(args: string): string | null {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  while (index < tokens.length && tokens[index]?.startsWith("-")) {
    index += tokens[index] === "-s" || tokens[index] === "-k" ? 2 : 1;
  }
  if (index < tokens.length && /^\d+(?:\.\d+)?[smhd]?$/.test(tokens[index]!)) {
    index += 1;
  }
  return index < tokens.length ? tokens.slice(index).join(" ") : null;
}

function stripNiceCommand(args: string): string | null {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  if (tokens[index] === "-n") {
    index += 2;
  } else {
    while (tokens[index]?.startsWith("-")) {
      index += 1;
    }
  }
  return index < tokens.length ? tokens.slice(index).join(" ") : null;
}

function stripArchCommand(args: string): string | null {
  const tokens = tokenizeCommandArgs(args);
  let index = 0;
  while (tokens[index]?.startsWith("-")) {
    index += 1;
  }
  return index < tokens.length ? tokens.slice(index).join(" ") : null;
}
