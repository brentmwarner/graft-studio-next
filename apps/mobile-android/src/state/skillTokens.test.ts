import { expect, it } from "vitest";

import {
  leadingSkill,
  mergeMessageSkills,
  skillChipLabel,
  skillDraft,
  skillEditorText,
  textAfterLeadingSkill,
} from "./skillTokens";

const review = { name: "review", displayName: "Code audit" };

it("labels a skill with its display name, then a title-cased id", () => {
  expect(skillChipLabel(review)).toBe("Code audit");
  expect(skillChipLabel({ name: "swiftui-specialist" })).toBe("Swiftui Specialist");
});

it("accepts only a completed leading slash or dollar invocation", () => {
  expect(leadingSkill("/review", [review])).toEqual(review);
  expect(leadingSkill("/review fix startup", [review])).toEqual(review);
  expect(leadingSkill("$review fix", [review])).toEqual(review);
  expect(leadingSkill("/reviewer", [review])).toBeUndefined();
  expect(leadingSkill("please /review", [review])).toBeUndefined();
  expect(leadingSkill("/tasks", [review])).toBeUndefined();
});

it("hides the invocation in the editor and restores it for the wire draft", () => {
  expect(skillEditorText("/review ", review)).toBe("");
  expect(skillEditorText("/review fix", review)).toBe("fix");
  expect(skillDraft("review", "")).toBe("/review ");
  expect(skillDraft("review", "fix")).toBe("/review fix");
  expect(textAfterLeadingSkill("/review fix", review)).toBe(" fix");
});

it("keeps the selected label when a host echo only has the skill id", () => {
  expect(mergeMessageSkills([{ name: "review" }], [review])).toEqual([review]);
  expect(mergeMessageSkills(undefined, [review])).toEqual([review]);
  expect(mergeMessageSkills([{ name: "review", displayName: "Audit" }], [review])).toEqual([
    { name: "review", displayName: "Audit" },
  ]);
});
