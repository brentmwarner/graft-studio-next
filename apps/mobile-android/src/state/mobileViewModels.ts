import {
  assertNeverMobile,
  type GraftEnvironmentSnapshot,
  type GraftTimelineEvent,
  type GraftTimelineEventData,
} from "@graft/mobile-contract";

export interface InboxThreadItem {
  readonly id: string;
  readonly title: string;
  readonly showsAttentionDot: boolean;
}

export interface InboxProjectGroup {
  readonly id: string;
  readonly kind: "repo" | "desktop";
  readonly name: string;
  readonly threads: readonly InboxThreadItem[];
}

export interface TranscriptToolItem {
  readonly id: string;
  readonly kind: "tool";
  readonly toolId: string;
  name: string;
  detail: string;
  running: boolean;
}

/// A structured thing the agent did — edited a file, ran a command, revised its
/// plan. Carries the host's `data` payload so the row can draw a real card;
/// `text` is the host's human-readable fallback, used when a payload is absent
/// or of a shape this build has no card for.
export interface TranscriptActivityItem {
  readonly id: string;
  readonly kind: "activity";
  readonly eventId: string;
  data?: GraftTimelineEventData;
  text: string;
}

export type TranscriptItem =
  | {
      readonly id: string;
      readonly kind: "user";
      text: string;
    }
  | {
      readonly id: string;
      readonly kind: "assistant";
      text: string;
      reasoning: string;
      streaming: boolean;
    }
  | TranscriptToolItem
  | TranscriptActivityItem
  /// A run of back-to-back tool calls folded into one row. A turn that shells
  /// out five times is one line of activity, not five identical "Using Bash…"
  /// rows. Mirrors the iOS `ToolActivityStrip`.
  | {
      readonly id: string;
      readonly kind: "toolGroup";
      readonly tools: readonly TranscriptToolItem[];
    }
  | {
      readonly id: string;
      readonly kind: "error";
      text: string;
    };

/// Fold consecutive `tool` rows into a single `toolGroup`. Quiet rows that
/// sit between tools (reasoning-only assistant bubbles, status banners)
/// stay inside the run so Claude's think→grep→think→bash pattern is one
/// line of activity, not a stack of identical "Using Bash…" rows. Mirrors
/// the iOS `ToolActivityStrip`.
export function groupToolRuns(
  items: readonly TranscriptItem[],
): readonly TranscriptItem[] {
  const grouped: TranscriptItem[] = [];
  let run: TranscriptToolItem[] = [];

  function flushRun(): void {
    const [first] = run;
    if (!first) return;
    // A lone tool call stays a plain row — folding one thing hides nothing and
    // costs a tap.
    grouped.push(
      run.length === 1
        ? first
        : { id: `toolgroup:${first.id}`, kind: "toolGroup", tools: run },
    );
    run = [];
  }

  for (const item of items) {
    if (item.kind === "tool") {
      run.push(item);
      continue;
    }
    if (run.length > 0 && isQuietToolRunRow(item)) continue;
    flushRun();
    grouped.push(item);
  }
  flushRun();
  return grouped;
}

function isQuietToolRunRow(item: TranscriptItem): boolean {
  if (item.kind === "assistant") return !item.text.trim();
  if (item.kind === "activity") {
    return (
      !item.data ||
      item.data.type === "todo_update" ||
      item.data.type === "web_search"
    );
  }
  return false;
}

// Legacy hosts suffix cumulative frames; Synara already sends the message ID.
export function transcriptMessageId(id: string): string {
  return id.replace(/:(?:delta:\d+|complete)$/, "");
}

function assistantRowId(event: GraftTimelineEvent): string {
  const channel = event.kind === "thinking.delta" ? "reasoning" : "assistant";
  return `${channel}:${transcriptMessageId(event.id)}`;
}

function normalizedText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function groupProjects(
  snapshot: GraftEnvironmentSnapshot | null,
  searchQuery: string,
): readonly InboxProjectGroup[] {
  if (!snapshot) return [];
  const activeThreadIds = new Set(
    snapshot.activeRuns.map((run) => run.threadId),
  );
  const query = searchQuery.trim().toLocaleLowerCase();
  const knownProjectIds = new Set(
    snapshot.projects.map((project) => project.id),
  );

  function threadItems(projectId: string): readonly InboxThreadItem[] {
    return snapshot!.threads
      .filter((thread) => thread.projectId === projectId)
      .map((thread) => ({
        id: thread.id,
        title: thread.title,
        showsAttentionDot:
          activeThreadIds.has(thread.id) ||
          thread.status === "running" ||
          thread.status === "needs_attention",
      }))
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  const groups: InboxProjectGroup[] = snapshot.projects.map((project) => ({
    id: project.id,
    kind: project.kind,
    name: project.name,
    threads: threadItems(project.id),
  }));
  const orphanThreads = snapshot.threads
    .filter((thread) => !knownProjectIds.has(thread.projectId))
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      showsAttentionDot:
        activeThreadIds.has(thread.id) ||
        thread.status === "running" ||
        thread.status === "needs_attention",
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
  if (orphanThreads.length > 0) {
    groups.push({
      id: "_orphans",
      kind: "desktop",
      name: "Other",
      threads: orphanThreads,
    });
  }

  if (!query) return groups;
  return groups.flatMap((group) => {
    if (group.name.toLocaleLowerCase().includes(query)) return [group];
    const threads = group.threads.filter((thread) =>
      thread.title.toLocaleLowerCase().includes(query),
    );
    return threads.length > 0 ? [{ ...group, threads }] : [];
  });
}

function isTerminalRunStatus(status: GraftTimelineEvent["runStatus"]): boolean {
  switch (status) {
    case "completed":
    case "failed":
    case "cancelled":
      return true;
    case "queued":
    case "running":
    case "waiting":
    case undefined:
      return false;
    default:
      return assertNeverMobile(status);
  }
}

/// Identity, never position. A settled transcript's cursors are synthetic (see
/// `mergeTimelineEvents`), so keying on them let an unrelated settled part
/// shadow a streamed frame that happened to share its number.
function eventKey(event: GraftTimelineEvent): string {
  return `${event.kind}:${event.id}:${event.text ?? ""}`;
}

/// Splice the streamed tail onto the snapshot's settled transcript.
///
/// `snapshotCursor` is the journal position the snapshot was taken at, and is
/// the ONLY authority on what the snapshot already covers. The settled events'
/// own cursors cannot answer that: the host numbers them 1..N off the length of
/// the part tail it returned, so on a long thread (500 parts against a journal
/// cursor of 40) they run an order of magnitude past the real position. Deriving
/// the threshold from them therefore discarded every streamed frame, and the
/// transcript only advanced when the HTTP snapshot behind it landed — which is
/// what "streaming doesn't work" looked like from the outside.
export function mergeTimelineEvents(
  settledEvents: readonly GraftTimelineEvent[],
  liveEvents: readonly GraftTimelineEvent[],
  snapshotCursor: number,
): readonly GraftTimelineEvent[] {
  const seen = new Set(settledEvents.map(eventKey));
  const merged = [...settledEvents];
  for (const event of liveEvents) {
    if (event.cursor > 0 && event.cursor <= snapshotCursor) continue;
    // Structured events revise in place under a stable id, and the revision
    // lives in `data` — which the key can't see. Deduping them by kind/id/text
    // would collapse a plan's whole history to its first version. The builder
    // folds them by id anyway, so a genuine duplicate is a harmless re-apply.
    if (event.data) {
      merged.push(event);
      continue;
    }
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  return merged;
}

/// FlatList keys must be unique or rows silently stop updating. Row ids are
/// derived from event ids, and a settled run plus its still-streaming live
/// tail can derive the same base id twice, so collisions are suffixed
/// deterministically — the same event stream always yields the same ids,
/// which is what lets `reconcileTranscriptItems` match rows across rebuilds.
function claimId(usedIds: Set<string>, base: string): string {
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  let suffix = 2;
  while (usedIds.has(`${base}#${suffix}`)) suffix += 1;
  const id = `${base}#${suffix}`;
  usedIds.add(id);
  return id;
}

export function buildTranscriptItems(
  settledEvents: readonly GraftTimelineEvent[],
  liveEvents: readonly GraftTimelineEvent[],
  snapshotCursor = 0,
): readonly TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const usedIds = new Set<string>();
  const toolItems = new Map<
    string,
    Extract<TranscriptItem, { kind: "tool" }>
  >();
  const activityItems = new Map<string, TranscriptActivityItem>();
  const assistantItems = new Map<string, Extract<TranscriptItem, { kind: "assistant" }>>();
  const completedMessages = new Set<string>();
  const assistantRunIds = new Map<string, string | undefined>();
  const optimisticIds = new Set(liveEvents.filter((event) => event.cursor === 0).map((event) => event.id));
  let currentAssistant:
    | Extract<TranscriptItem, { kind: "assistant" }>
    | undefined;
  /// The host can echo a user turn either before or after the local optimistic
  /// row. Keep the most recent candidate's source as well as its text so either
  /// ordering collapses to one bubble without dropping two authoritative turns
  /// that happen to contain the same words.
  let userEchoCandidate:
    | { readonly normalizedText: string; readonly optimistic: boolean }
    | undefined;

  function settleAssistant(): void {
    if (!currentAssistant) return;
    currentAssistant.streaming = false;
    if (!currentAssistant.text.trim() && !currentAssistant.reasoning.trim()) {
      const index = items.indexOf(currentAssistant);
      if (index >= 0) items.splice(index, 1);
    }
    currentAssistant = undefined;
  }

  function assistantFor(event: GraftTimelineEvent) {
    const id = assistantRowId(event);
    const existing = assistantItems.get(id);
    if (existing) return existing;
    settleAssistant();
    const item: Extract<TranscriptItem, { kind: "assistant" }> = {
      id,
      kind: "assistant",
      text: "",
      reasoning: "",
      streaming: true,
    };
    assistantItems.set(id, item);
    assistantRunIds.set(id, event.runId);
    items.push(item);
    currentAssistant = item;
    return item;
  }

  for (const event of mergeTimelineEvents(
    settledEvents,
    liveEvents,
    snapshotCursor,
  )) {
    switch (event.kind) {
      case "user.message": {
        const text = event.text?.trim() ?? "";
        if (!text) break;
        const normalized = normalizedText(text);
        const optimistic = optimisticIds.has(event.id);
        // Only `sendMessage` creates cursor-zero events. Pair one such event
        // with one authoritative event, regardless of which arrived
        // first. Same-source repeats remain distinct user turns.
        if (
          userEchoCandidate?.normalizedText === normalized &&
          userEchoCandidate.optimistic !== optimistic
        ) {
          // Keep the candidate authoritative after consuming the pair. This
          // also covers a snapshot that places the settled assistant response
          // between the authoritative user row and its lingering live echo.
          userEchoCandidate = {
            normalizedText: normalized,
            optimistic: false,
          };
          break;
        }
        settleAssistant();
        items.push({
          id: claimId(usedIds, `user:${event.id}`),
          kind: "user",
          text,
        });
        userEchoCandidate = { normalizedText: normalized, optimistic };
        break;
      }
      case "assistant.delta":
      case "assistant.message":
      case "thinking.delta": {
        const text = event.text ?? "";
        const id = assistantRowId(event);
        if (!text.trim() && !assistantItems.has(id)) break;
        const item = assistantFor(event);
        // A delayed/replayed delta cannot turn a completed reply back into a
        // live row or replace its authoritative final text with a prefix.
        if (event.kind !== "assistant.message" && completedMessages.has(item.id)) break;
        if (event.kind === "thinking.delta") item.reasoning = text;
        else if (text) item.text = text;
        item.streaming = event.kind !== "assistant.message";
        if (event.kind === "assistant.message") {
          completedMessages.add(item.id);
          if (currentAssistant === item) currentAssistant = undefined;
        }
        break;
      }
      case "tool.start":
      case "tool.update":
      case "tool.end": {
        const existing = toolItems.get(event.id);
        if (existing) {
          existing.name = event.toolName ?? existing.name;
          existing.detail = event.text ?? existing.detail;
          existing.running = event.kind !== "tool.end";
        } else {
          settleAssistant();
          const item: TranscriptToolItem = {
            id: claimId(usedIds, `tool:${event.id}`),
            kind: "tool",
            toolId: event.id,
            name: event.toolName ?? "Working",
            detail: event.text ?? "",
            running: event.kind !== "tool.end",
          };
          toolItems.set(event.id, item);
          items.push(item);
        }
        break;
      }
      case "run.status":
        if (isTerminalRunStatus(event.runStatus)) {
          for (const item of assistantItems.values()) {
            const runId = assistantRunIds.get(item.id);
            if (event.runId && runId && event.runId !== runId) continue;
            item.streaming = false;
            completedMessages.add(item.id);
            if (currentAssistant === item) currentAssistant = undefined;
          }
        }
        break;
      case "error": {
        settleAssistant();
        const text = event.text?.trim() || "Something went wrong.";
        const last = items.at(-1);
        if (last?.kind !== "error" || last.text !== text) {
          items.push({
            id: claimId(usedIds, `error:${event.id}`),
            kind: "error",
            text,
          });
        }
        break;
      }
      // Transient phases have one owner: the thread's live status. Persisting
      // them as rows repeats "Thinking" and moves replies when they disappear.
      case "status":
        break;
      // Structured activity the agent performed. Plans and todo lists are
      // revised repeatedly under the same part id, so these update in place —
      // appending would stack a dozen near-identical plan cards down the turn.
      case "file.edit":
      case "shell.command":
      case "plan.update":
      case "todo.update":
      case "web.search":
      case "subagent.update":
      case "artifact":
      case "image": {
        const text = event.text?.trim() ?? "";
        if (!text && !event.data) break;
        const existing = activityItems.get(event.id);
        if (existing) {
          if (event.data) existing.data = event.data;
          if (text) existing.text = text;
          break;
        }
        settleAssistant();
        const item: TranscriptActivityItem = {
          id: claimId(usedIds, `activity:${event.id}`),
          kind: "activity",
          eventId: event.id,
          data: event.data,
          text,
        };
        activityItems.set(event.id, item);
        items.push(item);
        break;
      }
      case "approval.requested":
      case "approval.resolved":
      case "question.requested":
      case "question.resolved":
      case "diff.updated":
        break;
      default:
        assertNeverMobile(event.kind);
    }
  }

  return groupToolRuns(items);
}

/// Events are stable objects across rebuilds, so identity settles this in one
/// comparison almost every time. The structural fallback only runs once the
/// host has actually sent a new payload — by which point the answer is nearly
/// always "different" and we want the card to redraw anyway.
function sameActivityData(
  left: GraftTimelineEventData | undefined,
  right: GraftTimelineEventData | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.type !== right.type) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameTranscriptItem(
  left: TranscriptItem,
  right: TranscriptItem,
): boolean {
  if (left.id !== right.id || left.kind !== right.kind) return false;
  switch (left.kind) {
    case "user":
      return left.text === (right as typeof left).text;
    case "assistant": {
      const other = right as typeof left;
      return (
        left.text === other.text &&
        left.reasoning === other.reasoning &&
        left.streaming === other.streaming
      );
    }
    case "tool": {
      const other = right as typeof left;
      return (
        left.name === other.name &&
        left.detail === other.detail &&
        left.running === other.running
      );
    }
    case "toolGroup": {
      const other = right as typeof left;
      return (
        left.tools.length === other.tools.length &&
        left.tools.every((tool, index) => {
          const counterpart = other.tools[index];
          return counterpart ? sameTranscriptItem(tool, counterpart) : false;
        })
      );
    }
    case "activity": {
      const other = right as typeof left;
      // A plan or todo list is revised in place, and the revision lives
      // entirely inside `data` — comparing by reference would call every
      // rebuild equal and freeze the card on its first version.
      return (
        left.text === other.text && sameActivityData(left.data, other.data)
      );
    }
    case "error":
      return left.text === (right as typeof left).text;
    default:
      return assertNeverMobile(left);
  }
}

/// Port of the iOS `ChatModel.applyReconciledItems` reconcile. `buildTranscriptItems`
/// mints brand-new row objects on every rebuild, and a rebuild happens for every
/// streamed token — so handing those straight to `FlatList` re-renders the whole
/// transcript per token (the 2.4s list updates). Reuse the previous object for
/// every row whose content is unchanged so `React.memo` rows bail out and only
/// the streaming tail repaints. When nothing changed at all, the previous array
/// itself is returned, so the list never re-renders on an idle snapshot refresh.
export function reconcileTranscriptItems(
  previous: readonly TranscriptItem[],
  fresh: readonly TranscriptItem[],
): readonly TranscriptItem[] {
  if (previous.length === 0) return fresh;

  const previousById = new Map(previous.map((item) => [item.id, item]));
  let changed = previous.length !== fresh.length;
  const merged = fresh.map((item, index) => {
    const existing = previousById.get(item.id);
    if (existing && sameTranscriptItem(existing, item)) {
      if (previous[index] !== existing) changed = true;
      return existing;
    }
    changed = true;
    return item;
  });

  return changed ? merged : previous;
}
