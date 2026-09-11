import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { toastManager } from "~/components/ui/toast";
import {
  connectSshMachine,
  createMobilePairingLink,
  deleteSshMachine,
  disconnectSshMachine,
  listSshMachines,
  saveSshMachine,
  type GraftMobilePairingLink,
} from "~/graftConnections";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import {
  SettingsEmptyState,
  SettingsListRow,
  SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";

const SSH_QUERY_KEY = ["graft", "ssh-machines"] as const;

function copyWithToast(value: string, title: string): void {
  void copyTextToClipboard(value).then(
    () => toastManager.add({ type: "success", title }),
    (error: unknown) =>
      toastManager.add({
        type: "error",
        title: "Could not copy",
        description: error instanceof Error ? error.message : "Clipboard access failed.",
      }),
  );
}

function pairingExpiryLabel(expiresAt: number): string {
  return `Expires ${new Date(expiresAt).toLocaleTimeString()}`;
}

export function ConnectionsSettingsPanel(props: { active: boolean }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [sshTarget, setSshTarget] = useState("");
  const [pairing, setPairing] = useState<GraftMobilePairingLink | null>(null);

  const sshQuery = useQuery({
    queryKey: SSH_QUERY_KEY,
    queryFn: listSshMachines,
    enabled: props.active,
    staleTime: 5_000,
  });

  const pairingMutation = useMutation({
    mutationFn: createMobilePairingLink,
    onSuccess: (result) => {
      setPairing(result);
      toastManager.add({
        type: "success",
        title: "Pairing link ready",
        description:
          "Scan or paste it in Graft on iOS or Android. The token stays in the fragment.",
      });
    },
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: "Could not create a pairing link",
        description: error instanceof Error ? error.message : "Pairing failed.",
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () => saveSshMachine({ label: label.trim(), sshTarget: sshTarget.trim() }),
    onSuccess: () => {
      setLabel("");
      setSshTarget("");
      void queryClient.invalidateQueries({ queryKey: SSH_QUERY_KEY });
    },
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: "Could not save SSH machine",
        description: error instanceof Error ? error.message : "Save failed.",
      }),
  });

  const connectMutation = useMutation({
    mutationFn: connectSshMachine,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SSH_QUERY_KEY });
    },
    onError: (error: unknown) =>
      toastManager.add({
        type: "error",
        title: "Could not connect over SSH",
        description: error instanceof Error ? error.message : "Connect failed.",
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

  if (!props.active) return null;

  const machines = sshQuery.data?.machines ?? [];

  return (
    <>
      <SettingsSection title="Mobile pairing">
        <SettingsRow
          title="Pair a phone"
          description="Create a one-time graft://pair link. Graft iOS and Android exchange it for a revocable bearer. The token stays after #."
          control={
            <Button
              type="button"
              size="sm"
              onClick={() => pairingMutation.mutate()}
              disabled={pairingMutation.isPending}
            >
              {pairingMutation.isPending ? "Creating…" : "Create pairing link"}
            </Button>
          }
        />
        {pairing ? (
          <SettingsRow
            title="Pairing URL"
            description={pairingExpiryLabel(pairing.expiresAt)}
            control={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copyWithToast(pairing.pairingUrl, "Copied pairing link")}
              >
                Copy
              </Button>
            }
          >
            <p className="break-all font-mono text-xs text-muted-foreground">
              {pairing.pairingUrl}
            </p>
          </SettingsRow>
        ) : null}
      </SettingsSection>
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
    </>
  );
}
