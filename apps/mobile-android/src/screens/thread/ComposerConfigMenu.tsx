import type { GraftApprovalPolicyOption, GraftModelOption } from "@graft/mobile-contract";
import { useEffect, useRef, useState, type ReactElement } from "react";

import { AnchoredMenu, MenuCaption, MenuItem } from "../../components/AnchoredMenu";
import { displayName } from "./displayName";

export type ComposerMenuPage = "options" | "intelligence" | "models" | "permissions";
export interface ComposerMenuConfig {
  readonly currentApproval: string | undefined;
  readonly approvalOptions: readonly GraftApprovalPolicyOption[];
  readonly currentModel: GraftModelOption | undefined;
  readonly models: readonly GraftModelOption[];
  readonly efforts: readonly string[];
  readonly resolvedEffort: string | undefined;
  readonly enabled: boolean;
  readonly onSelectApproval: (policy: string) => boolean | Promise<boolean>;
  readonly onSelectModel: (model: GraftModelOption) => boolean | Promise<boolean>;
  readonly onSelectEffort: (effort: string) => void;
}

const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"];

export function ComposerConfigMenu({ config, initialPage, trigger }: {
  readonly config: ComposerMenuConfig;
  readonly initialPage: ComposerMenuPage;
  readonly trigger: (open: () => void) => ReactElement;
}) {
  const [page, setPage] = useState(initialPage);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const applying = useRef(false);
  const enabled = config.enabled && !pending;
  useEffect(() => () => { generation.current += 1; }, []);

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
        return <>
          <MenuCaption>Composer options</MenuCaption>
          <MenuItem label="Model and effort" detail={config.currentModel?.label} disclosure onPress={() => setPage("intelligence")} />
          {config.approvalOptions.length > 0 ? <MenuItem label="Permissions" disclosure onPress={() => setPage("permissions")} /> : null}
        </>;
      case "permissions":
        return <>
          <MenuCaption>Permissions</MenuCaption>
          {config.approvalOptions.map((option) => <MenuItem key={option.value} label={option.label} detail={option.description}
            selected={option.value === config.currentApproval} enabled={enabled}
            onPress={() => void select(() => config.onSelectApproval(option.value), close)} />)}
        </>;
      case "models":
        return <>
          <MenuItem label="‹ Model and effort" enabled={!pending} onPress={() => setPage("intelligence")} />
          {config.models.map((model) => <MenuItem key={`${model.providerId}:${model.id}`} label={model.label}
            detail={model.providerLabel ?? displayName(model.providerId)} enabled={enabled}
            selected={model.id === config.currentModel?.id && model.providerId === config.currentModel.providerId}
            onPress={() => void select(() => config.onSelectModel(model), close)} />)}
        </>;
      case "intelligence":
        return <>
          <MenuItem label="Model" detail={config.currentModel?.label ?? "Choose model"} disclosure enabled={!pending} onPress={() => setPage("models")} />
          {config.efforts.length > 0 ? <MenuCaption>Reasoning effort</MenuCaption> : null}
          {[...config.efforts].sort((a, b) => {
            const rank = (effort: string) => { const index = EFFORT_ORDER.indexOf(effort); return index < 0 ? 999 : index; };
            return rank(a) - rank(b);
          }).map((effort) => <MenuItem key={effort} label={displayName(effort)} selected={effort === config.resolvedEffort} enabled={enabled}
            onPress={() => { config.onSelectEffort(effort); close(); }} />)}
        </>;
      default: {
        const exhaustive: never = page;
        return exhaustive;
      }
    }
  }

  return <AnchoredMenu trigger={trigger} onOpenChange={(open) => {
    generation.current += 1;
    if (open) { setPage(initialPage); setError(undefined); }
  }}>
    {(close) => <>
      {contents(close)}
      {!config.enabled ? <MenuCaption>Reconnect to change settings.</MenuCaption> : null}
      {pending ? <MenuCaption>Applying…</MenuCaption> : null}
      {error ? <MenuCaption>{error}</MenuCaption> : null}
    </>}
  </AnchoredMenu>;
}
