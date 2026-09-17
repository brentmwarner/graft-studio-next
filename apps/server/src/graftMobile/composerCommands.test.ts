import type { ProviderSkillDescriptor } from "@graft/contracts";
import { describe, expect, it } from "vitest";

import { mobileComposerCommands, prepareMobileSlashMessage } from "./composerCommands";

const skills: ProviderSkillDescriptor[] = [
  {
    name: "swiftui-specialist",
    path: "/workspace/.agents/skills/swiftui-specialist/SKILL.md",
    enabled: true,
    description: "Native SwiftUI",
  },
  { name: "disabled", path: "/private/disabled/SKILL.md", enabled: false },
];

describe("mobile composer commands", () => {
  it("combines real provider commands and enabled skills with app actions", () => {
    expect(
      mobileComposerCommands(
        [{ name: "/compact", description: "Compact context" }, { name: "model" }],
        skills,
      ),
    ).toEqual([
      expect.objectContaining({ name: "model", kind: "model" }),
      expect.objectContaining({ name: "tasks", kind: "tasks" }),
      { name: "compact", description: "Compact context", kind: "native" },
      { name: "swiftui-specialist", description: "Native SwiftUI", kind: "skill" },
    ]);
  });
  it("sends a discovered skill reference, with its arguments, to the provider", () => {
    expect(
      prepareMobileSlashMessage(
        "/swiftui-specialist fix streaming",
        mobileComposerCommands([], skills),
        skills,
      ),
    ).toEqual({
      text: "/swiftui-specialist fix streaming",
      skills: [{ name: skills[0]!.name, path: skills[0]!.path }],
    });
  });
  it("rejects an unavailable skill without accepting a client-supplied path", () => {
    expect(() =>
      prepareMobileSlashMessage("/disabled", mobileComposerCommands([], skills), skills),
    ).toThrow("Unknown command");
  });
  it("keeps native commands and ordinary paths intact", () => {
    const catalog = mobileComposerCommands([{ name: "compact" }], []);
    expect(prepareMobileSlashMessage("/compact", catalog, [])).toEqual({ text: "/compact" });
    expect(prepareMobileSlashMessage("/Users/brent/project", catalog, [])).toEqual({
      text: "/Users/brent/project",
    });
  });
  it("preserves the authored task command for optimistic echo and reconnect", () => {
    const result = prepareMobileSlashMessage(
      "/tasks improve streaming",
      mobileComposerCommands([], []),
      [],
    );
    expect(result.text).toBe("/tasks improve streaming");
    expect(mobileComposerCommands([], [], false).some((command) => command.kind === "tasks")).toBe(
      false,
    );
  });
});
