import type { GraftModelOption, GraftThreadSummary } from "@graft/mobile-contract";

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
