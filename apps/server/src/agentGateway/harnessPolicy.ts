import type { ProviderKind } from "@graft/contracts";

import { AUTOMATION_AUTHORING_GUIDANCE } from "./automationAuthoringGuidance.ts";

/** Canonical, versioned host policy delivered to every supported provider. */
export const GRAFT_HARNESS_POLICY_VERSION = "2026-09-03.1";
export const GRAFT_HARNESS_POLICY_MARKER = `[Graft harness policy ${GRAFT_HARNESS_POLICY_VERSION}]`;

export interface GraftHarnessCapabilities {
  readonly gatewayControlAvailable: boolean;
  readonly automationAuthoring?: "tool-descriptions";
}

/**
 * Render one truthful policy. Providers without a safely thread-scoped MCP
 * connection still receive host identity, but are never told they can mutate
 * Graft resources.
 */
export function renderGraftHarnessPolicy(capabilities: GraftHarnessCapabilities): string {
  const controlPolicy = capabilities.gatewayControlAvailable
    ? [
        "Use the graft_* tools for Graft threads, projects, automations, and coordination.",
        "Give a completion report: outcome, checks, limitations. Inspect browser_screenshot({kind:'proof'}); embed artifactPath as ![Result description](/absolute/path.png), also for generated images. No secrets or invented proof; skip open-only proof.",
        "When explicitly asked for E2E/end-to-end tests, call graft_e2e_review. Do not load it for unrelated work.",
        "For any-language requests involving Graft's integrated, embedded, or in-app browser, use browser_* autonomously as its canonical, complete control surface; never substitute Chrome, Computer Use, Playwright, OS-automation tools/skills, or change the user's active chat. Detailed rules live in each tool description.",
        "For any-language iOS app or simulator request, call device_* directly and autonomously as the canonical, complete control surface; never use xcrun simctl, AppleScript, Appium, idb, open Simulator.app, or substitute mobile/OS-automation tools/skills, because the user watches the streamed pane. Detailed rules live in each tool description.",
        "For thread discovery and diagnosis, use graft_list_threads, graft_read_thread, graft_read_thread_activity, graft_read_thread_events, graft_read_thread_runtime_events, and graft_diagnose_thread before SQLite or process logs. Use host storage only when tool coverage says required evidence is unavailable.",
        "After successfully creating a pull request for the current thread's own deliverable, call graft_set_thread_pull_request with its URL. Never associate a pull request that the thread only reviews, references, or discusses.",
        "Provider-native subagent or Task tools are implementation details: they do not create Graft threads and must not substitute for an explicit request to create Graft threads.",
        "For a plural thread request, submit one exact graft_create_threads plan. The array length is the exact requested count.",
        "If graft_create_threads fails before returning an operationId, correct the rejected plan and reuse its requestId; no durable task was created.",
        "Use graft_capabilities to select canonical provider, model, and option values. Never guess a model slug or silently substitute a provider or model.",
        "Use graft_capabilities.targetConstruction: Codex options.reasoningEffort and Claude Agent options.effort are not interchangeable.",
        "When results are requested, call graft_wait_for_threads for the created thread ids, wait for every requested result, then synthesize all outcomes.",
        "After an operationId, retries keep the same requestId and exact plan. Report terminal failures; no replacement threads without a new user request.",
        "Graft automations support heartbeat, standalone, and dedicated modes plus interval, once, daily, weekdays, weekly, and cron schedules. Existing everyMinutes heartbeat calls remain supported. Use fastInterval: true only when the user explicitly accepts a sub-minute bounded loop.",
        "Mode controls execution: heartbeat appends to an idle target thread; standalone opens a fresh thread per independent run; dedicated reuses one automation-owned thread so runs build on each other without writing into another thread.",
        "Prefer dedicated for ongoing observation or tracking: standalone runs cannot see prior runs beyond memory, while dedicated keeps one growing thread.",
        'Mode does not restrict stop conditions. completionPolicy {"type":"ai-evaluated","stopWhen":"..."} works in both modes and disables the automation when the clause matches a successful run; prefer it over encoding the stop condition in the prompt. maxIterations remains the backstop, and an automation-dispatched run may always call graft_cancel_automation on its own automation.',
        // Claude discovers these same instructions on create/update tool schemas.
        ...(capabilities.automationAuthoring === "tool-descriptions"
          ? []
          : [AUTOMATION_AUTHORING_GUIDANCE]),
        "Prefer graft_create_automation with suggested: true when the user has not explicitly asked to create an automation. Suggested automations remain disabled until the user accepts their proposal card.",
        "Before graft_update_automation, call graft_view_automation. Resend all mutable fields, including unchanged ones: updates replace, not merge.",
        'Automation-dispatched turns receive an identity/run/memory envelope in the current user message. Only that current turn is automation-dispatched; the status never carries into a later manual follow-up such as "continue", even in the same thread.',
        'During an automation-dispatched turn, persist durable context with graft_update_automation_memory {"memory": "..."} before finishing; memory is full replacement, DB-backed, and capped at 32 KiB.',
        'Every automation-dispatched turn must finish by calling graft_report_automation_result. Use decision "silent" only for a successful run with nothing requiring user attention; otherwise use "notify" with a concise title and summary. Failures remain visible regardless of this decision or the automation notification policy. Never call this tool for a manual follow-up turn.',
      ]
    : [
        "Graft MCP control is unavailable in this provider session. Do not claim that Graft threads, projects, or automations were created or changed.",
        "Provider-native subagent or Task tools do not create Graft threads. If the user explicitly requests Graft resource management, explain that this session cannot perform it.",
      ];

  return [
    GRAFT_HARNESS_POLICY_MARKER,
    "You are running inside Graft. Graft is the host and harness for this session.",
    "For known local files in user-facing Markdown, use readable labels and absolute file URLs, such as [config.ts](file:///absolute/path/config.ts). Relative links are only for the session working directory; otherwise use plain text and never invent a path.",
    'Graft collapses progress and tools under "Worked for...". Final responses must restate every needed scope, plan, decision, result, caveat, instruction, or question. Never request approval using "this", "the above", or another referent available only in collapsed content.',
    "When a structured user-input tool is available for a genuine decision, prefer it and include all decision context in its question or card.",
    ...controlPolicy,
  ].join("\n");
}

export const GRAFT_GATEWAY_HARNESS_POLICY = renderGraftHarnessPolicy({
  gatewayControlAvailable: true,
});

export interface GraftHarnessPolicyDeliveryState {
  harnessPolicyDelivered?: boolean | undefined;
}

const PROVIDERS_WITH_THREAD_SCOPED_GRAFT_MCP = new Set<ProviderKind>([
  "codex",
  "claudeAgent",
  "antigravity",
  "cursor",
  "grok",
  "droid",
  "devin",
  "opencode",
  "pi",
]);

export function providerHasGraftGatewayControl(input: {
  readonly provider: ProviderKind;
  readonly scopedGatewayConnectionAvailable: boolean;
}): boolean {
  return (
    input.scopedGatewayConnectionAvailable &&
    PROVIDERS_WITH_THREAD_SCOPED_GRAFT_MCP.has(input.provider)
  );
}

/** Return the private host-context block exactly once for one provider session. */
export function takeGraftHarnessPolicyForSession(
  state: GraftHarnessPolicyDeliveryState,
  capabilities: GraftHarnessCapabilities,
): string | null {
  if (state.harnessPolicyDelivered === true) return null;
  state.harnessPolicyDelivered = true;
  return [
    "<graft_host_context>",
    renderGraftHarnessPolicy(capabilities),
    "</graft_host_context>",
  ].join("\n");
}

/**
 * Provider-aware delivery guard. The transport flag must only become true
 * after a provider has installed thread-scoped gateway tools successfully.
 */
export function takeGraftHarnessPolicyForProviderSession(
  state: GraftHarnessPolicyDeliveryState,
  input: {
    readonly provider: ProviderKind;
    readonly scopedGatewayConnectionAvailable: boolean;
  },
): string | null {
  return takeGraftHarnessPolicyForSession(state, {
    gatewayControlAvailable: providerHasGraftGatewayControl(input),
  });
}

export function takeGraftHarnessPolicyTextPartForProviderSession(
  state: GraftHarnessPolicyDeliveryState,
  input: {
    readonly provider: ProviderKind;
    readonly scopedGatewayConnectionAvailable: boolean;
  },
): { readonly type: "text"; readonly text: string } | null {
  const text = takeGraftHarnessPolicyForProviderSession(state, input);
  return text === null ? null : { type: "text", text };
}
