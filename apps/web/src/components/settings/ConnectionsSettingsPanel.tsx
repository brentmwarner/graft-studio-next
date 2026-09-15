import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { toastManager } from "~/components/ui/toast";
import { ConnectionsPanel, type ConnectionsStatus } from "./ConnectionsPanel";
import {
  connectSshMachine,
  connectGraftRelay,
  createMobilePairingLink,
  deleteSshMachine,
  disconnectSshMachine,
  getConnectionsStatus,
  listSshMachines,
  revokeConnectionsDevice,
  saveSshMachine,
  setConnectionsEnabled,
} from "~/graftConnections";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import {
  SettingsEmptyState,
  SettingsListRow,
  SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";

const SSH_QUERY_KEY = ["graft", "ssh-machines"] as const;
const CONNECTIONS_QUERY_KEY = ["graft", "connections-status"] as const;

const EMPTY_STATUS: ConnectionsStatus = {
  enabled: false,
  networkAccessEnabled: false,
  keepHostAwake: false,
  environmentId: "",
  environmentLabel: "Studio",
  bindHost: "127.0.0.1",
  port: null,
  endpoints: [],
  devices: [],
  pairingUrl: null,
  pairingExpiresAt: null,
  relay: { state: "disabled", lastError: null },
};

function copyQuietly(value: string, errorTitle: string): void {
  void copyTextToClipboard(value).catch((error: unknown) =>
    toastManager.add({
      type: "error",
      title: errorTitle,
      description: error instanceof Error ? error.message : "Clipboard access failed.",
    }),
  );
}

export function ConnectionsSettingsPanel(props: { active: boolean }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [sshTarget, setSshTarget] = useState("");
  const [keepHostAwake, setKeepHostAwake] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sshQuery = useQuery({
    queryKey: SSH_QUERY_KEY,
    queryFn: listSshMachines,
    enabled: props.active,
    staleTime: 5_000,
  });

  const connectionsQuery = useQuery({
    queryKey: CONNECTIONS_QUERY_KEY,
    queryFn: getConnectionsStatus,
    enabled: props.active,
    staleTime: 2_000,
    refetchInterval: (query) =>
      query.state.data?.enabled
        ? query.state.data.relay.state === "connecting"
          ? 1_000
          : 5_000
        : false,
  });

  useEffect(() => {
    if (!props.active) return;
    const bridge = window.desktopBridge?.connections;
    if (!bridge) return;
    void bridge.getKeepHostAwake().then(setKeepHostAwake);
  }, [props.active]);

  useEffect(() => {
    const enabled = connectionsQuery.data?.enabled === true;
    void window.desktopBridge?.connections?.syncWake(enabled);
  }, [connectionsQuery.data?.enabled]);

  const saveMutation = useMutation({
    mutationFn: () => saveSshMachine({ label: label.trim(), sshTarget: sshTarget.trim() }),
    onSuccess: () => {
      setLabel("");
      setSshTarget("");
      void queryClient.invalidateQueries({ queryKey: SSH_QUERY_KEY });
    },
    onError: (cause: unknown) =>
      toastManager.add({
        type: "error",
        title: "Could not save SSH machine",
        description: cause instanceof Error ? cause.message : "Save failed.",
      }),
  });

  const connectMutation = useMutation({
    mutationFn: connectSshMachine,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SSH_QUERY_KEY });
    },
    onError: (cause: unknown) =>
      toastManager.add({
        type: "error",
        title: "Could not connect over SSH",
        description: cause instanceof Error ? cause.message : "Connect failed.",
      }),
  });

  const disconnectMutation = useMutation({
    mutationFn: disconnectSshMachine,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SSH_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSshMachine,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SSH_QUERY_KEY });
    },
  });

  const enabledMutation = useMutation({
    mutationFn: setConnectionsEnabled,
    onSuccess: (status) => {
      setError(null);
      queryClient.setQueryData(CONNECTIONS_QUERY_KEY, status);
      void window.desktopBridge?.connections?.syncWake(status.enabled);
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not update the gateway."),
  });

  const relayMutation = useMutation({
    mutationFn: connectGraftRelay,
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not connect the Graft relay."),
  });

  const pairingMutation = useMutation({
    mutationFn: async () => {
      if (!connectionsQuery.data?.enabled) {
        await setConnectionsEnabled(true);
      }
      return createMobilePairingLink();
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not create a pairing link."),
  });

  const revokeMutation = useMutation({
    mutationFn: revokeConnectionsDevice,
    onSuccess: (status) => {
      queryClient.setQueryData(CONNECTIONS_QUERY_KEY, status);
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not revoke that device."),
  });

  if (!props.active) return null;

  const machines = sshQuery.data?.machines ?? [];
  const httpStatus = connectionsQuery.data;
  const status: ConnectionsStatus = {
    ...EMPTY_STATUS,
    enabled: httpStatus?.enabled ?? EMPTY_STATUS.enabled,
    networkAccessEnabled: httpStatus?.networkAccessEnabled ?? EMPTY_STATUS.networkAccessEnabled,
    environmentId: httpStatus?.environmentId ?? EMPTY_STATUS.environmentId,
    environmentLabel: httpStatus?.environmentLabel ?? EMPTY_STATUS.environmentLabel,
    bindHost: httpStatus?.bindHost ?? EMPTY_STATUS.bindHost,
    port: httpStatus?.port ?? EMPTY_STATUS.port,
    endpoints: httpStatus?.endpoints ?? EMPTY_STATUS.endpoints,
    devices: httpStatus?.devices ?? EMPTY_STATUS.devices,
    pairingUrl: httpStatus?.pairingUrl ?? EMPTY_STATUS.pairingUrl,
    pairingExpiresAt: httpStatus?.pairingExpiresAt ?? EMPTY_STATUS.pairingExpiresAt,
    relay: httpStatus?.relay ?? EMPTY_STATUS.relay,
    keepHostAwake,
  };
  const busy =
    relayMutation.isPending ||
    enabledMutation.isPending ||
    pairingMutation.isPending ||
    revokeMutation.isPending ||
    connectionsQuery.isPending;

  return (
    <>
      <SettingsSection title="SSH machines">
        <SettingsRow
          title="Add a machine"
          description="Use an OpenSSH host or user@host. Graft shells out to system ssh with BatchMode=yes and does not store private keys."
          control={
            <Button
              type="button"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending || label.trim().length === 0 || sshTarget.trim().length === 0
              }
            >
              Save
            </Button>
          }
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Label"
              aria-label="SSH machine label"
            />
            <Input
              value={sshTarget}
              onChange={(event) => setSshTarget(event.target.value)}
              placeholder="user@host"
              aria-label="SSH target"
            />
          </div>
        </SettingsRow>
        {sshQuery.isError ? (
          <SettingsEmptyState tone="destructive">
            {sshQuery.error instanceof Error
              ? sshQuery.error.message
              : "Could not load SSH machines."}
          </SettingsEmptyState>
        ) : machines.length === 0 ? (
          <SettingsEmptyState>No SSH machines yet.</SettingsEmptyState>
        ) : (
          machines.map((machine) => (
            <SettingsListRow
              key={machine.id}
              title={machine.label}
              description={
                machine.connected
                  ? `Connected · ${machine.effectiveHostname ?? machine.sshTarget}`
                  : machine.sshTarget
              }
              actions={
                <div className="flex gap-2">
                  {machine.connected ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => disconnectMutation.mutate(machine.id)}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => connectMutation.mutate(machine.id)}
                    >
                      Connect
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => deleteMutation.mutate(machine.id)}
                  >
                    Remove
                  </Button>
                </div>
              }
            />
          ))
        )}
      </SettingsSection>
      <ConnectionsPanel
        status={status}
        busy={busy}
        error={
          error ?? (connectionsQuery.error instanceof Error ? connectionsQuery.error.message : null)
        }
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
        }}
        onSetEnabled={(enabled) => enabledMutation.mutate(enabled)}
        onSetKeepHostAwake={(next) => {
          setKeepHostAwake(next);
          void window.desktopBridge?.connections
            ?.setKeepHostAwake(next, status.enabled)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "Could not keep the host awake."),
            );
        }}
        onCreatePairing={() => pairingMutation.mutate()}
        onConnectRelay={() => relayMutation.mutate()}
        onCopyEndpoint={(httpBaseUrl) => copyQuietly(httpBaseUrl, "Could not copy address")}
        onRevokeDevice={(deviceId) => revokeMutation.mutate(deviceId)}
        onCopyDiagnostics={() =>
          copyQuietly(httpStatus?.diagnostics ?? "", "Could not copy diagnostics")
        }
      />
    </>
  );
}
