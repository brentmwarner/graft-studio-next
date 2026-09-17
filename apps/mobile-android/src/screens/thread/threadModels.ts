import type { GraftModelOption, GraftThreadSummary } from "@graft/mobile-contract";

export function modelSelectionId(model: Pick<GraftModelOption, "providerId" | "id">): string {
  return JSON.stringify([model.providerId, model.id]);
}

/** Only advertised efforts may be sent, including defaults from a newer host. */
export function resolveModelEffort(
  model: GraftModelOption | undefined,
  ...choices: readonly (string | undefined)[]
): string | undefined {
  const efforts = model?.reasoningEfforts ?? [];
  return [...choices, model?.defaultReasoningEffort, "high", efforts[0]].find(
    (choice): choice is string => choice !== undefined && efforts.includes(choice),
  );
}

export function groupModelsByProvider(models: readonly GraftModelOption[]) {
  const groups = new Map<string, { id: string; label: string; models: GraftModelOption[] }>();
  for (const model of models) {
    let group = groups.get(model.providerId);
    if (!group) {
      group = { id: model.providerId, label: model.providerLabel ?? model.providerId, models: [] };
      groups.set(model.providerId, group);
    }
    group.models.push(model);
  }
  return [...groups.values()];
}

export function threadModelChoices(
  thread: GraftThreadSummary,
  models: readonly GraftModelOption[],
  hasLocalActivity = false,
) {
  // Older hosts do not report the lock. Keep existing chats on their provider
  // until an authoritative host explicitly identifies an unstarted thread.
  const lockedProviderId =
    thread.providerLocked !== false || hasLocalActivity ? thread.providerId : undefined;
  const selectableModels = lockedProviderId
    ? models.filter((model) => model.providerId === lockedProviderId)
    : models;
  const providerModels = models.filter((model) => model.providerId === thread.providerId);
  const currentModel = thread.modelName
    ? providerModels.find((model) => model.id === thread.modelName)
    : (providerModels.find((model) => model.isDefault) ?? providerModels[0]);
  return { currentModel, lockedProviderId, selectableModels };
}
