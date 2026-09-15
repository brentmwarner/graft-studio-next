// FILE: ConnectionsPanel.tsx
// Purpose: Quiet Graft Mobile pairing overlay plus enable / keep-awake / relay status.
// Layer: Settings UI component
// Why: Port the original graft-studio pairing dialog without loud Dialog chrome.

import { useCallback, useEffect, useRef, useState, type FC, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as QRCode from "qrcode";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { CentralIcon } from "~/lib/central-icons";
import {
  DISCLOSURE_CLEANUP_BUFFER_MS,
  DISCLOSURE_TRANSITION_MS,
  disclosureContentClassName,
} from "~/lib/disclosureMotion";
import { cn } from "~/lib/utils";
import { SettingsCard, SettingsSectionShell } from "./SettingsPanelPrimitives";
import {
  SETTINGS_CARD_ROW_CLASS_NAME,
  SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME,
  SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME,
  SETTINGS_CARD_ROW_TITLE_CLASS_NAME,
  SETTINGS_STACKED_ROWS_DIVIDER_CLASS_NAME,
} from "~/settingsPanelStyles";

export type ConnectionsDevice = {
  deviceId: string;
  sessionId: string;
  label: string;
  platform: "ios" | "android" | "web" | "desktop";
  appVersion: string;
  environmentLabel: string;
  lastSeenAt: number;
  connected: boolean;
};

export type ConnectionsStatus = {
  enabled: boolean;
  networkAccessEnabled: boolean;
  keepHostAwake: boolean;
  environmentId: string;
  environmentLabel: string;
  bindHost: string;
  port: number | null;
  endpoints: Array<{
    kind: "relay" | "loopback" | "lan" | "tailnet" | "https";
    address: string;
    interfaceName: string;
    httpBaseUrl: string;
    wsBaseUrl: string;
  }>;
  devices: ConnectionsDevice[];
  pairingUrl: string | null;
  pairingExpiresAt: number | null;
  relay: {
    state: "disabled" | "connecting" | "connected" | "error";
    lastError: string | null;
  };
};

export type PairingDialogStep = "intro" | "qr";

export type ConnectionsPanelProps = {
  status: ConnectionsStatus;
  busy?: boolean;
  error?: string | null;
  defaultPairingDialogStep?: PairingDialogStep | null;
  onRefresh: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onSetKeepHostAwake: (enabled: boolean) => void;
  onCreatePairing: () => void;
  onConnectRelay?: () => void;
  onCopyEndpoint: (httpBaseUrl: string) => void;
  onRevokeDevice: (deviceId: string) => void;
  onCopyDiagnostics: () => void;
};

export const ConnectionsPanel: FC<ConnectionsPanelProps> = ({
  status,
  busy = false,
  error = null,
  defaultPairingDialogStep = null,
  onRefresh,
  onSetEnabled,
  onSetKeepHostAwake,
  onCreatePairing,
  onConnectRelay,
  onCopyEndpoint,
  onRevokeDevice,
  onCopyDiagnostics,
}) => {
  const [pairingDialogStep, setPairingDialogStep] = useState<PairingDialogStep | null>(
    defaultPairingDialogStep,
  );
  const [dialogOpen, setDialogOpen] = useState(defaultPairingDialogStep !== null);
  const closeTimer = useRef<number | undefined>(undefined);
  const hasRemoteEndpoint = status.endpoints.some((endpoint) => endpoint.kind !== "loopback");
  const relayIsConnected = status.relay.state === "connected";
  const pairingIsActive = Boolean(
    status.pairingUrl && status.pairingExpiresAt && status.pairingExpiresAt > Date.now(),
  );
  const pairingQr = usePairingQrCode(
    pairingIsActive ? status.pairingUrl : null,
    status.pairingExpiresAt,
  );

  const openPairingDialog = (step: PairingDialogStep) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setPairingDialogStep(step);
    setDialogOpen(true);
  };

  const closePairingDialog = useCallback(() => {
    setDialogOpen(false);
    closeTimer.current = window.setTimeout(() => {
      setPairingDialogStep(null);
    }, DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!pairingDialogStep || !dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePairingDialog();
    };
    document.addEventListener("keydown", onKeyDown);
    queueMicrotask(() => {
      document
        .querySelector<HTMLElement>(
          "[data-testid='connections-pairing-dialog'] [data-modal-initial-focus='true']",
        )
        ?.focus();
    });
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePairingDialog, dialogOpen, pairingDialogStep]);

  const beginPairing = () => {
    openPairingDialog("qr");
    onCreatePairing();
  };

  return (
    <div data-testid="connections-panel">
      <section aria-labelledby="paired-devices-heading" className="mb-9">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id="paired-devices-heading" className="text-[13px] font-medium text-foreground">
            Devices that can control this computer
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => openPairingDialog("intro")}
            data-testid="connections-add-device"
          >
            Add device
          </Button>
        </div>

        {status.devices.length === 0 ? (
          <SettingsCard>
            <div className="flex items-center gap-3.5 px-4 py-5">
              <CentralIcon name="devices" className="size-6 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-[13px] font-medium text-foreground">No paired devices</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Add a device to control this computer remotely.
                </p>
              </div>
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            <ul className={SETTINGS_STACKED_ROWS_DIVIDER_CLASS_NAME}>
              {status.devices.map((device) => (
                <li
                  key={device.deviceId}
                  className={cn(
                    SETTINGS_CARD_ROW_CLASS_NAME,
                    "flex items-center justify-between gap-4",
                  )}
                  data-testid={`connections-device-${device.deviceId}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-foreground">
                      <CentralIcon name="phone" className="size-[18px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className={cn(SETTINGS_CARD_ROW_TITLE_CLASS_NAME, "truncate")}>
                          {device.label}
                        </p>
                        {device.connected ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
                            <CentralIcon name="circle-check" className="size-[11px]" />
                            Connected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            Not connected
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Graft{device.appVersion ? ` ${device.appVersion}` : ""} for{" "}
                        {platformLabel(device.platform)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Last seen {new Date(device.lastSeenAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRevokeDevice(device.deviceId)}
                    disabled={busy}
                    aria-label={`Revoke ${device.label}`}
                    data-testid={`connections-revoke-${device.deviceId}`}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </SettingsCard>
        )}
      </section>

      <SettingsSectionShell title="Connection options">
        <div className="space-y-3">
          <SettingsCard>
            <div className={cn(SETTINGS_CARD_ROW_CLASS_NAME, "flex items-center justify-between")}>
              <div>
                <span className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>
                  Allow other devices to connect
                </span>
                <p className={cn(SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME, "mt-0.5")}>
                  Access this computer from your paired devices, wherever you are.
                </p>
              </div>
              <Switch
                checked={status.enabled}
                disabled={busy}
                aria-label="Allow other devices to connect"
                data-testid="connections-enable-toggle"
                onCheckedChange={(checked) => onSetEnabled(Boolean(checked))}
              />
            </div>

            {status.enabled ? (
              <div className={SETTINGS_CARD_ROW_CLASS_NAME} data-testid="connections-relay-status">
                <span className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>Graft relay</span>
                <p className={cn(SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME, "mt-0.5")}>
                  {relayStatusDescription(status.relay.state)}
                  {status.relay.state === "disabled"
                    ? " Connect your Graft account for access over cellular."
                    : ""}
                </p>
                {onConnectRelay && status.relay.state !== "connected" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={onConnectRelay}
                    disabled={busy || status.relay.state === "connecting"}
                  >
                    Connect Graft account
                  </Button>
                ) : null}
                {status.relay.lastError ? (
                  <p
                    className="mt-0.5 text-[11px] text-destructive"
                    data-testid="connections-relay-error"
                  >
                    {status.relay.lastError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className={SETTINGS_CARD_ROW_CLASS_NAME}>
              <div className="flex items-center justify-between">
                <div>
                  <span className={SETTINGS_CARD_ROW_TITLE_CLASS_NAME}>Keep host awake</span>
                  <p className={cn(SETTINGS_CARD_ROW_DESCRIPTION_CLASS_NAME, "mt-0.5")}>
                    Prevents sleep while remote access is enabled
                  </p>
                </div>
                <Switch
                  checked={status.keepHostAwake}
                  disabled={busy || !status.enabled}
                  aria-label="Keep host awake"
                  data-testid="connections-keep-awake-toggle"
                  onCheckedChange={(checked) => onSetKeepHostAwake(Boolean(checked))}
                />
              </div>
            </div>
          </SettingsCard>

          <SettingsCard divided={false}>
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-xs text-muted-foreground hover:text-foreground">
                Connection details
                <CentralIcon
                  name="chevron-down-small"
                  className="size-3.5 group-data-panel-open:rotate-180"
                />
              </CollapsibleTrigger>
              <CollapsiblePanel className={SETTINGS_CARD_ROW_DIVIDER_CLASS_NAME}>
                <div className={SETTINGS_STACKED_ROWS_DIVIDER_CLASS_NAME}>
                  {!status.enabled ? (
                    <p
                      className={cn(
                        SETTINGS_CARD_ROW_CLASS_NAME,
                        "text-[12px] text-muted-foreground",
                      )}
                      data-testid="connections-endpoint"
                    >
                      Gateway off — enable connections to detect addresses.
                    </p>
                  ) : (
                    <ul className={SETTINGS_STACKED_ROWS_DIVIDER_CLASS_NAME}>
                      {status.endpoints.map((endpoint) => (
                        <li
                          key={`${endpoint.kind}:${endpoint.address}`}
                          className={cn(
                            SETTINGS_CARD_ROW_CLASS_NAME,
                            "flex items-center justify-between gap-3",
                          )}
                          data-testid={`connections-endpoint-${endpoint.kind}`}
                        >
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium text-foreground">
                              {endpointLabel(endpoint.kind)}
                            </p>
                            <code className="block truncate text-[11px] text-muted-foreground">
                              {endpoint.httpBaseUrl}
                            </code>
                            <p className="text-[10px] text-muted-foreground">
                              {endpoint.kind === "relay"
                                ? "Works from any network"
                                : `Interface: ${endpoint.interfaceName}`}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => onCopyEndpoint(endpoint.httpBaseUrl)}
                            aria-label={`Copy ${endpointLabel(endpoint.kind)} address`}
                          >
                            Copy
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {status.enabled && !hasRemoteEndpoint ? (
                    <p
                      className="px-4 py-3 text-[11px] text-muted-foreground"
                      data-testid="connections-local-only"
                    >
                      Local only — no relay, private LAN, or Tailnet address was detected.
                    </p>
                  ) : null}
                  <p className="px-4 py-3 text-[11px] text-muted-foreground">
                    Environment: {status.environmentLabel || "Studio"}
                  </p>
                </div>
                <div className="flex items-center gap-2 px-4 pb-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={onCopyDiagnostics}
                    data-testid="connections-copy-diagnostics"
                  >
                    Copy diagnostics
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={onRefresh}
                    data-testid="connections-refresh"
                  >
                    Refresh
                  </Button>
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </SettingsCard>

          {error ? (
            <p
              role="alert"
              className="px-2 text-xs text-destructive"
              data-testid="connections-error"
            >
              {error}
            </p>
          ) : null}
        </div>
      </SettingsSectionShell>

      {pairingDialogStep
        ? createPortal(
            <div
              className={cn(
                "fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] transition-opacity duration-220 ease-out motion-reduce:transition-none",
                dialogOpen ? "opacity-100" : "opacity-0",
              )}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pairing-dialog-title"
              data-modal="true"
              data-testid="connections-pairing-dialog"
              tabIndex={-1}
              onClick={closePairingDialog}
            >
              <div
                className={disclosureContentClassName(
                  dialogOpen,
                  "relative max-h-[calc(100vh-32px)] w-[368px] max-w-full overflow-y-auto rounded-2xl border border-[color:var(--color-border)] bg-popover shadow-[0_16px_50px_-12px_rgba(0,0,0,0.34)]",
                )}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  aria-label="Close pairing dialog"
                  onClick={closePairingDialog}
                  className="absolute right-3 top-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                >
                  <CentralIcon name="cross-medium" className="size-3.5" />
                </button>

                {pairingDialogStep === "intro" ? (
                  <PairingIntroduction
                    busy={busy}
                    onLater={closePairingDialog}
                    onGetStarted={beginPairing}
                  />
                ) : (
                  <PairingQrStep
                    status={status}
                    busy={busy}
                    error={error}
                    relayIsConnected={relayIsConnected}
                    pairingIsActive={pairingIsActive}
                    pairingQr={pairingQr}
                    onCreatePairing={onCreatePairing}
                    onDone={closePairingDialog}
                  />
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

function PairingIntroduction({
  busy,
  onLater,
  onGetStarted,
}: {
  busy: boolean;
  onLater: () => void;
  onGetStarted: () => void;
}) {
  return (
    <div data-testid="connections-pairing-introduction">
      <img
        src="/connections-pairing-hero.png"
        alt="Graft Mobile inbox on an iPhone"
        className="h-[184px] w-full object-cover"
      />
      <div className="px-7 pb-5 pt-5">
        <div className="text-center">
          <h2 id="pairing-dialog-title" className="text-base font-semibold text-foreground">
            Connect a device to this computer
          </h2>
          <p className="mx-auto mt-1.5 max-w-[300px] text-[12px] leading-5 text-muted-foreground">
            Continue Graft work from your phone while this computer handles the local agent runtime.
          </p>
        </div>

        <ul className="mt-6 space-y-4">
          <PairingBenefit
            icon={<CentralIcon name="phone" className="size-[17px]" />}
            title="Pick up where you left off"
            description="Follow active projects and continue work from Graft Mobile."
          />
          <PairingBenefit
            icon={<CentralIcon name="bell" className="size-[17px]" />}
            title="Stay in the loop"
            description="See when agent work finishes or needs your attention."
          />
          <PairingBenefit
            icon={<CentralIcon name="box-sparkle" className="size-[17px]" />}
            title="Start something new"
            description="Send instructions from your phone while this computer does the work."
          />
        </ul>

        <div className="mt-6 flex justify-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="min-w-[70px]"
            onClick={onLater}
          >
            Later
          </Button>
          <Button
            type="button"
            size="lg"
            className="min-w-[104px]"
            disabled={busy}
            onClick={onGetStarted}
            data-modal-initial-focus="true"
            data-testid="connections-pairing-get-started"
          >
            Get started
          </Button>
        </div>
      </div>
    </div>
  );
}

function PairingBenefit({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <li className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-foreground">
        {icon}
      </div>
      <div>
        <p className="text-[12px] font-medium leading-5 text-foreground">{title}</p>
        <p className="max-w-[260px] text-[11px] leading-[17px] text-muted-foreground">
          {description}
        </p>
      </div>
    </li>
  );
}

function PairingQrStep({
  status,
  busy,
  error,
  relayIsConnected,
  pairingIsActive,
  pairingQr,
  onCreatePairing,
  onDone,
}: {
  status: ConnectionsStatus;
  busy: boolean;
  error: string | null;
  relayIsConnected: boolean;
  pairingIsActive: boolean;
  pairingQr: { dataUrl: string | null; failed: boolean };
  onCreatePairing: () => void;
  onDone: () => void;
}) {
  const [linkCopied, setLinkCopied] = useState(false);
  const onCopyLink = useCallback(() => {
    if (!status.pairingUrl) return;
    void copyTextToClipboard(status.pairingUrl).then(() => {
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    });
  }, [status.pairingUrl]);

  return (
    <div className="px-7 pb-5 pt-7" data-testid="connections-pairing-qr-step">
      <div className="text-center">
        <h2 id="pairing-dialog-title" className="text-base font-semibold text-foreground">
          Scan with Graft Mobile
        </h2>
        <p className="mx-auto mt-1.5 max-w-[310px] text-[12px] leading-5 text-muted-foreground">
          Open Graft Mobile, choose Pair with Graft Studio, then scan this one-time code.
        </p>
      </div>

      <div className="mx-auto mt-5 flex h-[220px] w-[220px] items-center justify-center rounded-2xl border border-[color:var(--color-border)] bg-white p-3 shadow-sm">
        {pairingIsActive && pairingQr.dataUrl ? (
          <img
            src={pairingQr.dataUrl}
            alt={`Scan to pair Graft Mobile with ${status.environmentLabel}`}
            className="h-full w-full"
            data-testid="connections-pairing-qr"
          />
        ) : pairingQr.failed && status.pairingUrl ? (
          <span className="px-4 text-center text-[12px] leading-5 text-neutral-600" role="status">
            QR unavailable. Use the pairing link below.
          </span>
        ) : (
          <span className="px-4 text-center text-[12px] leading-5 text-neutral-500" role="status">
            {busy || pairingIsActive ? "Preparing your secure code…" : "This code has expired."}
          </span>
        )}
      </div>

      {pairingQr.failed && status.pairingUrl ? (
        <code
          className="mt-3 block max-h-14 overflow-hidden break-all rounded-lg p-2 font-mono text-[10px] text-muted-foreground"
          data-testid="connections-pairing-url"
        >
          {status.pairingUrl}
        </code>
      ) : null}

      {pairingIsActive && status.pairingUrl ? (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={onCopyLink}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[color:var(--color-border)] px-2.5 py-1.5 text-xs text-foreground hover:bg-muted/40"
            data-testid="connections-copy-pairing-link"
          >
            <CentralIcon name={linkCopied ? "circle-check" : "clipboard"} className="size-[13px]" />
            {linkCopied ? "Copied" : "Copy pairing link"}
          </button>
        </div>
      ) : null}

      <div className="mt-4 text-center">
        {pairingIsActive && status.pairingExpiresAt ? (
          <p className="text-[11px] text-muted-foreground">
            Expires {new Date(status.pairingExpiresAt).toLocaleString()}
          </p>
        ) : null}
        <p
          className="mt-1 text-[10px] text-muted-foreground"
          data-testid="connections-pairing-reachability"
        >
          {relayIsConnected
            ? "Single-use and generated on this computer. Your phone can be on any network."
            : "Single-use and generated on this computer. Your phone needs to reach this computer's network."}
        </p>
        {error ? (
          <p className="mt-2 text-[11px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex justify-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="min-w-[70px]"
          onClick={onDone}
        >
          Done
        </Button>
        <Button
          type="button"
          size="lg"
          className="min-w-[126px]"
          disabled={busy}
          onClick={onCreatePairing}
          data-modal-initial-focus="true"
          data-testid="connections-create-pairing"
        >
          {pairingIsActive ? "Create new code" : "Generate code"}
        </Button>
      </div>
    </div>
  );
}

function relayStatusDescription(state: ConnectionsStatus["relay"]["state"]): string {
  switch (state) {
    case "disabled":
      return "Not connected. Pairing uses this computer's LAN or Tailnet address.";
    case "connecting":
      return "Connecting…";
    case "connected":
      return "Connected. Your devices can reach this computer from any network.";
    case "error":
      return "Unavailable. Pairing falls back to LAN or Tailnet.";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function platformLabel(platform: ConnectionsDevice["platform"]): string {
  switch (platform) {
    case "ios":
      return "iOS";
    case "android":
      return "Android";
    case "web":
      return "Web";
    case "desktop":
      return "desktop";
    default: {
      const exhaustive: never = platform;
      return exhaustive;
    }
  }
}

function endpointLabel(kind: ConnectionsStatus["endpoints"][number]["kind"]): string {
  switch (kind) {
    case "relay":
      return "Graft relay";
    case "loopback":
      return "Local";
    case "lan":
      return "LAN";
    case "tailnet":
      return "Tailnet";
    case "https":
      return "HTTPS";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function usePairingQrCode(
  pairingUrl: string | null,
  expiresAt: number | null,
): { dataUrl: string | null; failed: boolean } {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    setDataUrl(null);
    setFailed(false);

    if (!pairingUrl || !expiresAt || expiresAt <= Date.now()) {
      return () => undefined;
    }

    void QRCode.toString(pairingUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      color: { dark: "#111827", light: "#ffffff" },
    })
      .then((svg) => {
        if (!cancelled) {
          setDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    expiryTimer = setTimeout(
      () => setDataUrl(null),
      Math.min(expiresAt - Date.now(), 2_147_483_647),
    );

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [expiresAt, pairingUrl]);

  return { dataUrl, failed };
}
