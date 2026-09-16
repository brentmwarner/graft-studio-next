# Mobile transcript presentation

## References

The September 2026 comparison uses the user's four completed-chat screenshots: two from Cursor and two from Codex in ChatGPT. They show the whole reading surface, including work details and the final answer. The screenshots are the visual reference; launch-page artwork alone does not establish completed-turn behavior.

- [Cursor for iOS](https://cursor.com/blog/ios-mobile-app) and [Cursor's mobile documentation](https://cursor.com/docs/cloud-agent/mobile) describe the native mobile agent workflow and streaming/reconnect behavior.
- [Work with Codex from anywhere](https://openai.com/index/work-with-codex-from-anywhere/) describes following desktop tasks and their outputs from ChatGPT mobile.
- Graft desktop's `apps/web/src/components/ChatMarkdown.tsx` uses the info color for inline links and preserves authored link labels.

The references do not publish exact font metrics or chunk timing. The values below are Graft's implementation choices, informed by the supplied screenshots.

## Transcript and streaming

Streaming and completed replies use the same native selectable text, typography,
and link styling. Received text is coalesced every 32ms; completion, corrections,
and Reduce Motion flush immediately. Partial inline link destinations show their
label until the link closes. Literal code remains unchanged.

The live turn retains its original order. When it finishes, commentary, reasoning,
and tools fold into a “Worked for …” disclosure above the final answer. The duration
uses host timestamps. Expanding restores the original details; no model rewrites
the answer. Only the final reply exposes message actions.

One status footer remains mounted during interleaved text, thinking, and tools.
Its two-second shimmer does not restart when the label changes. Terminal events
settle all indicators, including after reconnect; delayed frames cannot revive
completed messages or tools. Reduce Motion uses steady text. Reconnect and approval
states do not animate as active work.

Paragraphs have 5pt extra line spacing and 22pt gaps; headings have 28pt before and
12pt after them. Lists preserve numbering, nesting, and task markers, with 7pt item
gaps. Code and tables scroll horizontally. Neutral filled cards, pills, fields,
and composer surfaces use fill and spacing without decorative strokes.

## Links and skills

Inline web links use `#2F789C` in light mode and `#78B7D5` in dark mode, without an
underline. Authored labels and bare URLs remain in the prose. Sources are available
from the message menu rather than a second capsule under each answer.

Workspace file references are resolved by Studio against the thread workspace.
Verified references become blue links with a file-type marker and open a bounded
native preview. Unknown paths remain text; the gateway rejects paths outside the
workspace. File resolution does not change fenced code or existing authored links.

Skills use the desktop building-blocks icon, a readable display name, description,
and preview action. The selected skill appears as a blue icon and label in the
composer, sent message, and matching assistant references. History preserves skill
identity without exposing host paths. Literal code and unrelated links stay literal.

The `/` palette overlays the composer without changing the transcript inset. The
client caches and preloads commands for the current thread/provider; stale results
cannot replace a newer catalog. Host discovery runs concurrently with bounded
read capacity so a slow provider cannot delay cancellation or heartbeat handling.
Mutating commands retain receive order. `/model` opens model controls; `/tasks`
creates a tracked checklist. Enabled skills resolve on Studio before dispatch.

## Tasks and changes

Normalized `turn.tasks.updated` activities carry the same structured task data in
live events and reconnect snapshots. iOS also accepts named `plan.update` lists.
Malformed rich data does not discard its event or clear valid tasks. Unfinished
lists carry across turns until replaced or explicitly cleared; stale older-turn
updates cannot replace a newer list.

The Tasks pill sits opposite the diff control. Its Liquid Glass checklist expands
upward over the transcript, capped at 260pt, without moving the composer. The jump
to latest arrow appears above that row only while scrolled away. Reduced Motion
removes the expansion animation.

Studio enables `tools.update_plan.enabled=true` for its Codex processes. Default-mode
guidance asks for structured task updates when the user requests a tracked list;
creating a list does not authorize executing it. This also powers desktop task UI.

The diff control shows the current working tree across turns and disappears when
it is clean. Binary, rename, and mode-only changes retain a file count without a
misleading `+0 −0`. Tapping gives haptic feedback and dismisses the keyboard before
presenting the sheet. File previews use the current working patch and preserve
syntax highlighting, bounds, and truncated/unavailable states.

Android shares structured task progress, slash commands, tool identity, working
changes, and reading styles. Its current attachment, dictation, usage, anchored
menu, and provider-lock behavior is preserved.

## Model controls

New chat uses a native provider → model menu. Each provider has the same brand mark
as desktop; Intelligence lists only the selected model's supported efforts. The
model and permission pills use interactive Liquid Glass with 44pt hit targets.
A policy with no alternatives uses noninteractive glass.

In an existing conversation, tapping the model name opens a compact effort control
that replaces and blurs the composer area. The stepped capsule supports the
model's advertised effort levels. The Advanced sheet groups Model and Intelligence,
and shows Speed only when supported. Provider changes remain locked after the
conversation starts, while models and effort remain selectable within its provider.

Model catalogs have shared loading, retry, and selection state. Studio must confirm
a model change before its label updates. Rejected and timed-out changes retain a
recoverable error and reconcile with the host. New chats preserve supported effort
choices and otherwise use the provider's advertised default.

Provider marks come from `apps/web/src/components/Icons.tsx` and
`AntigravityIcon.tsx`. Monochrome marks use template rendering. Claude retains its
orange mark, OpenCode has a dark-appearance variant, and Antigravity uses 1x/2x/3x
exports to preserve its SVG masks and blurred color layers.

## Verification

See [PR verification and visual evidence](review/ios-desktop-parity/README.md) for
checks run against the integrated branch, simulator captures, and remaining gaps.
Unit and hosted fixture tests do not establish live provider or physical-device
behavior; those checks are identified separately.
