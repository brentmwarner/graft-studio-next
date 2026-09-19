import type {
  GraftApprovalPolicyOption,
  GraftModelOption,
  GraftInteractionMode,
} from "@graft/mobile-contract";
import { useEffect, useRef, useState, type ReactElement } from "react";

import { AnchoredMenu, MenuCaption, MenuItem } from "../../components/AnchoredMenu";
import type { ModelCatalogStatus } from "../../state/useModelCatalog";
import type { AttachmentSource } from "./composerAttachmentSend";
import { displayName } from "./displayName";
import { groupModelsByProvider } from "./threadModels";

export type ComposerMenuPage =
  | "options"
  | "intelligence"
  | "providers"
  | "models"
  | "permissions"
  | "mode"
  | "speed";
export interface ComposerMenuConfig {
  readonly catalog?: ModelCatalogStatus;
  readonly onReloadModels?: () => void;
  readonly extras?: {
    readonly attachmentsEnabled: boolean;
    readonly modesEnabled: boolean;
    readonly fastModeEnabled: boolean;
    readonly interactionMode: GraftInteractionMode;
    readonly fastMode: boolean;
    readonly busy: boolean;
    readonly onAttach: (source: AttachmentSource) => void;
    readonly onSelectMode: (mode: GraftInteractionMode) => void;
    readonly onSelectFastMode: (enabled: boolean) => void;
  };
  readonly currentApproval: string | undefined;
  readonly approvalOptions: readonly GraftApprovalPolicyOption[];
  readonly currentModel: GraftModelOption | undefined;
  readonly lockedProviderId?: string;
  readonly models: readonly GraftModelOption[];
  readonly efforts: readonly string[];
  readonly resolvedEffort: string | undefined;
  readonly enabled: boolean;
  readonly onSelectApproval: (policy: string) => boolean | Promise<boolean>;
  readonly onSelectModel: (model: GraftModelOption) => boolean | Promise<boolean>;
  readonly onSelectEffort: (effort: string) => void;
}

const EFFORT_ORDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
];

export function ComposerConfigMenu({
  config,
  initialPage,
  trigger,
  openRequest,
}: {
  readonly config: ComposerMenuConfig;
  readonly initialPage: ComposerMenuPage;
  readonly trigger: (open: () => void) => ReactElement;
  readonly openRequest?: number;
}) {
  const modelPage = config.lockedProviderId ? "models" : "providers";
  const startingPage = initialPage === "providers" ? modelPage : initialPage;
  const [page, setPage] = useState<ComposerMenuPage>(startingPage);
  const [providerId, setProviderId] = useState(
    config.lockedProviderId ?? config.currentModel?.providerId,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const applying = useRef(false);
  const enabled = config.enabled && !pending;
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  async function select(action: () => boolean | Promise<boolean>, close: () => void) {
    if (applying.current || !config.enabled) return;
    applying.current = true;
    const request = generation.current;
    setPending(true);
    setError(undefined);
    try {
      const accepted = await action();
      if (request !== generation.current) return;
      if (accepted) close();
      else setError("Couldn’t apply this change. Try again.");
    } catch {
      if (request === generation.current) setError("Couldn’t apply this change. Try again.");
    } finally {
      applying.current = false;
      setPending(false);
    }
  }

  function contents(close: () => void) {
    switch (page) {
      case "options":
        return (
          <>
            {(
              [
                ["files", "Add files", "document-outline"],
                ["photos", "Photos", "images-outline"],
                ["camera", "Camera", "camera-outline"],
              ] as const
            ).map(([source, label, icon]) => (
              <MenuItem
                key={source}
                label={label}
                icon={icon}
                enabled={Boolean(config.extras && !config.extras.busy)}
                onPress={() => {
                  close();
                  config.extras?.onAttach(source);
                }}
              />
            ))}
            <MenuItem
              label="Mode"
              icon="options-outline"
              disclosure
              detail={displayName(config.extras?.interactionMode ?? "default")}
              enabled={Boolean(config.extras?.modesEnabled && !config.extras.busy)}
              onPress={() => setPage("mode")}
            />
            {config.currentModel?.supportsFastMode ? (
              <MenuItem
                label="Speed"
                icon="flash-outline"
                disclosure
                detail={config.extras?.fastMode ? "Fast" : "Normal"}
                enabled={Boolean(config.extras?.fastModeEnabled && !config.extras.busy)}
                onPress={() => setPage("speed")}
              />
            ) : null}
            {!config.extras?.attachmentsEnabled ? (
              <MenuCaption>
                You can attach files now. Reconnect to an updated Studio to send them.
              </MenuCaption>
            ) : null}
          </>
        );
      case "mode":
        return (
          <>
            <MenuItem label="‹ Composer options" onPress={() => setPage("options")} />
            {(["default", "plan", "debug"] as const).map((mode) => (
              <MenuItem
                key={mode}
                label={displayName(mode)}
                detail={
                  mode === "plan"
                    ? "Plan the work before making changes"
                    : mode === "debug"
                      ? "Investigate and fix a problem"
                      : "Work on the task"
                }
                selected={config.extras?.interactionMode === mode}
                enabled={Boolean(config.extras?.modesEnabled && !config.extras.busy)}
                onPress={() => {
                  config.extras?.onSelectMode(mode);
                  close();
                }}
              />
            ))}
          </>
        );
      case "speed":
        return (
          <>
            <MenuItem label="‹ Composer options" onPress={() => setPage("options")} />
            {[false, true].map((fast) => (
              <MenuItem
                key={String(fast)}
                label={fast ? "Fast" : "Normal"}
                selected={config.extras?.fastMode === fast}
                enabled={Boolean(config.extras?.fastModeEnabled && !config.extras.busy)}
                onPress={() => {
                  config.extras?.onSelectFastMode(fast);
                  close();
                }}
              />
            ))}
          </>
        );
      case "permissions":
        return (
          <>
            <MenuCaption>Permissions</MenuCaption>
            {config.approvalOptions.map((option) => (
              <MenuItem
                key={option.value}
                label={option.label}
                detail={option.description}
                selected={option.value === config.currentApproval}
                enabled={enabled}
                onPress={() => void select(() => config.onSelectApproval(option.value), close)}
              />
            ))}
          </>
        );
      case "providers":
        return (
          <>
            <MenuCaption>Provider</MenuCaption>
            {groupModelsByProvider(config.models).map((provider) => (
              <MenuItem
                key={provider.id}
                label={provider.label}
                disclosure
                selected={provider.id === config.currentModel?.providerId}
                enabled={enabled}
                onPress={() => {
                  setProviderId(provider.id);
                  setPage("models");
                }}
              />
            ))}
          </>
        );
      case "models":
        return (
          <>
            {config.lockedProviderId ? (
              <MenuCaption>Model</MenuCaption>
            ) : (
              <MenuItem
                label="‹ Providers"
                enabled={!pending}
                onPress={() => setPage("providers")}
              />
            )}
            {config.models
              .filter((model) => model.providerId === (config.lockedProviderId ?? providerId))
              .map((model) => (
                <MenuItem
                  key={`${model.providerId}:${model.id}`}
                  label={model.label}
                  detail={model.providerLabel ?? displayName(model.providerId)}
                  enabled={enabled}
                  selected={
                    model.id === config.currentModel?.id &&
                    model.providerId === config.currentModel.providerId
                  }
                  onPress={() => void select(() => config.onSelectModel(model), close)}
                />
              ))}
          </>
        );
      case "intelligence":
        return (
          <>
            <MenuItem
              label="Model"
              detail={config.currentModel?.label ?? "Choose model"}
              disclosure
              enabled={!pending}
              onPress={() => setPage(modelPage)}
            />
            {config.efforts.length > 0 ? <MenuCaption>Reasoning effort</MenuCaption> : null}
            {[...config.efforts]
              .sort((a, b) => {
                const rank = (effort: string) => {
                  const index = EFFORT_ORDER.indexOf(effort);
                  return index < 0 ? 999 : index;
                };
                return rank(a) - rank(b);
              })
              .map((effort) => (
                <MenuItem
                  key={effort}
                  label={displayName(effort)}
                  selected={effort === config.resolvedEffort}
                  enabled={enabled}
                  onPress={() => {
                    if (!enabled) return;
                    config.onSelectEffort(effort);
                    close();
                  }}
                />
              ))}
          </>
        );
      default: {
        const exhaustive: never = page;
        return exhaustive;
      }
    }
  }

  return (
    <AnchoredMenu
      trigger={trigger}
      openRequest={openRequest}
      onOpenChange={(open) => {
        generation.current += 1;
        if (open) {
          setPage(startingPage);
          setProviderId(config.lockedProviderId ?? config.currentModel?.providerId);
          setError(undefined);
        }
      }}
    >
      {(close) => (
        <>
          {contents(close)}
          {page === "providers" || page === "models" || page === "intelligence" ? (
            <>
              {config.catalog?.loading ? <MenuCaption>Loading models…</MenuCaption> : null}
              {config.catalog?.error ? <MenuCaption>{config.catalog.error}</MenuCaption> : null}
              {config.onReloadModels ? (
                <MenuItem
                  label={config.catalog?.error ? "Retry loading models" : "Refresh models"}
                  icon="refresh-outline"
                  enabled={config.enabled && !config.catalog?.loading && !pending}
                  onPress={config.onReloadModels}
                />
              ) : null}
            </>
          ) : null}
          {!config.enabled ? <MenuCaption>Reconnect to change settings.</MenuCaption> : null}
          {pending ? <MenuCaption>Applying…</MenuCaption> : null}
          {error ? <MenuCaption>{error}</MenuCaption> : null}
        </>
      )}
    </AnchoredMenu>
  );
}
