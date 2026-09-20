import { expect, it } from "vitest";

import { reconcileTranscriptItems, type TranscriptItem } from "../../state/mobileViewModels";
import { transcriptFollowContent } from "../../state/transcriptFollow";
import { presentTranscript } from "./presentTranscript";

const user: TranscriptItem = { id: "u", kind: "user", text: "Fix it" };
const thought: TranscriptItem = {
  id: "r",
  kind: "assistant",
  text: "",
  reasoning: "Checking",
  streaming: false,
};
const note: TranscriptItem = {
  id: "n",
  kind: "assistant",
  text: "I found the issue",
  reasoning: "",
  streaming: false,
};
const tool: TranscriptItem = {
  id: "t",
  kind: "tool",
  toolId: "t",
  name: "Working",
  detail: "Checked",
  running: false,
};
const answer: TranscriptItem = {
  id: "a",
  kind: "assistant",
  text: "Fixed **it**.",
  reasoning: "",
  streaming: false,
};
const error: TranscriptItem = { id: "e", kind: "error", text: "A check failed" };
const activity: TranscriptItem = { id: "f", kind: "activity", eventId: "f", text: "Changed file" };
const rows = [user, thought, note, tool, activity, answer, error];

it("keeps the final answer, errors and structured results visible while folding all work", () => {
  const presented = presentTranscript(rows, false);
  expect(presented.map((item) => item.id)).toEqual(["u", "f", "a", "e"]);
  expect(presented[2]).toEqual({ ...answer, foldedActivity: [thought, note, tool] });
});
it("leaves the active turn and interrupted turns without an answer intact", () => {
  expect(presentTranscript(rows, true)).toEqual(rows);
  const interrupted = [user, thought, tool, error];
  expect(presentTranscript(interrupted, false)).toEqual(interrupted);
});
it("folds older turns while another response is streaming and flattens tool groups", () => {
  const group: TranscriptItem = {
    id: "g",
    kind: "toolGroup",
    tools: [tool, { ...tool, id: "t2" }],
  };
  const active = { ...answer, id: "next", streaming: true };
  const result = presentTranscript([user, group, answer, { ...user, id: "u2" }, active], true);
  expect(result[1]).toEqual({ ...answer, foldedActivity: group.tools });
  expect(result.at(-1)).toBe(active);
});
it("does not mutate the raw text used for follow decisions when a turn folds", () => {
  const before = transcriptFollowContent(rows);
  presentTranscript(rows, false);
  expect(transcriptFollowContent(rows)).toEqual(before);
  expect(answer).not.toHaveProperty("foldedActivity");
});

it("keeps settled folded rows memoized during later streaming but refreshes changed work", () => {
  const settled = presentTranscript(rows, false);
  const active = { ...answer, id: "next", streaming: true };
  const next = reconcileTranscriptItems(
    settled,
    presentTranscript([...rows, { ...user, id: "u2" }, active], true),
  );
  expect(next.find((item) => item.id === answer.id)).toBe(
    settled.find((item) => item.id === answer.id),
  );
  const changed = reconcileTranscriptItems(
    settled,
    presentTranscript([user, { ...tool, detail: "Updated result" }, answer], false),
  );
  expect(changed.at(-1)).not.toBe(settled.find((item) => item.id === answer.id));
});
