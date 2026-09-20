import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { ConnectionsPanel, type ConnectionsStatus } from "./ConnectionsPanel";
import { SshConnectionsPanel } from "./SshConnectionsPanel";
import {
  connectGraftRelay,
  createMobilePairingLink,
  getConnectionsStatus,
  revokeConnectionsDevice,
  setConnectionsEnabled,
  type GraftConnectionsStatus,
} from "~/graftConnections";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
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
  const [keepHostAwake, setKeepHostAwake] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    mutationFn: async () => {
      const account = window.desktopBridge?.account;
      if (account?.connectRelay) {
        await account.connectRelay();
        return { ok: true } as const;
      }
      return connectGraftRelay();
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
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
    onSuccess: async (pairing) => {
      queryClient.setQueryData<GraftConnectionsStatus>(CONNECTIONS_QUERY_KEY, (previous) =>
        previous
          ? { ...previous, pairingUrl: pairing.pairingUrl, pairingExpiresAt: pairing.expiresAt }
          : previous,
      );
      setError(null);
      await queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
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

  const httpStatus = connectionsQuery.data;
  const hidePairingCode = pairingMutation.isPending || pairingMutation.isError;
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
    pairingUrl: hidePairingCode ? null : (httpStatus?.pairingUrl ?? EMPTY_STATUS.pairingUrl),
    pairingExpiresAt: hidePairingCode
      ? null
      : (httpStatus?.pairingExpiresAt ?? EMPTY_STATUS.pairingExpiresAt),
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
      <SshConnectionsPanel active={props.active} />
      {props.active ? (
        <ConnectionsPanel
          status={status}
          busy={busy}
          error={
            error ??
            (connectionsQuery.error instanceof Error ? connectionsQuery.error.message : null)
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
      ) : null}
    </>
  );
}
