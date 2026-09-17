import type { GraftModelOption, GraftThreadSummary } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";

import { groupModelsByProvider, resolveModelEffort, threadModelChoices } from "./threadModels";

const models: GraftModelOption[] = [
  { id: "shared-name", providerId: "codex", label: "Codex model", isDefault: true },
  { id: "shared-name", providerId: "claudeAgent", label: "Claude model" },
  { id: "another-model", providerId: "claudeAgent", label: "Another Claude model" },
];
const thread: GraftThreadSummary = {
  id: "thread",
  projectId: "project",
  title: "Chat",
  updatedAt: 1,
  providerId: "claudeAgent",
  modelName: "shared-name",
  providerLocked: true,
};

describe("thread model choices", () => {
  it("groups providers without conflating shared model IDs", () => {
    expect(groupModelsByProvider(models).map((group) => [group.id, group.models.length])).toEqual([
      ["codex", 1],
      ["claudeAgent", 2],
    ]);
  });

  it("resolves explicit, host-confirmed and advertised effort without sending unsupported values", () => {
    const model = {
      ...models[0]!,
      reasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    };
    expect(resolveModelEffort(model, "low", "high")).toBe("low");
    expect(resolveModelEffort(model, "xhigh", "low")).toBe("low");
    expect(resolveModelEffort(model, undefined, "unsupported")).toBe("medium");
    expect(resolveModelEffort({ ...model, defaultReasoningEffort: "unsupported" })).toBe("high");
    expect(resolveModelEffort({ ...model, reasoningEfforts: [] }, "high")).toBeUndefined();
    expect(resolveModelEffort(undefined, "high")).toBeUndefined();
  });
  it("keeps all models from the locked provider selectable", () => {
    const result = threadModelChoices(thread, models);
    expect(result.selectableModels).toEqual(models.slice(1));
    expect(result.currentModel).toEqual(models[1]);
  });

  it("allows provider choice in an unstarted chat, then locks on local activity", () => {
    const unstarted = { ...thread, providerLocked: false };
    expect(threadModelChoices(unstarted, models).selectableModels).toEqual(models);
    expect(threadModelChoices(unstarted, models, true).selectableModels).toEqual(models.slice(1));
  });

  it("protects chats on older hosts and never falls back to another provider's catalog", () => {
    expect(
      threadModelChoices({ ...thread, providerLocked: undefined }, models).selectableModels,
    ).toEqual(models.slice(1));
    const missing = threadModelChoices({ ...thread, providerId: "missing" }, models);
    expect(missing.selectableModels).toEqual([]);
    expect(missing.currentModel).toBeUndefined();
  });
});
