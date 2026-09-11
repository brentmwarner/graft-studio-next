import { useCallback, useEffect, useState, type FC } from "react";
import {
  IconCheckCircle2,
  IconCrossMedium as IconX,
  IconPlusMedium as IconPlus,
  IconServer,
  IconTrashCan as IconTrash,
} from "@central-icons-react/round-outlined-radius-3-stroke-1.5";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { useModalFocus } from "@renderer/hooks/useModalFocus";
import type { SshMachineSummary } from "@renderer/lib/sshMachinePort";
import { SETTINGS_STACK } from "./settingsChrome";

export interface SshMachinesSectionProps {
  machines: SshMachineSummary[];
  busy?: boolean;
  onSaveMachine: (input: { label: string; sshTarget: string }) => Promise<void>;
  onConnectMachine: (machineId: string) => Promise<void>;
  onDisconnectMachine: (machineId: string) => Promise<void>;
  onDeleteMachine: (machineId: string) => Promise<void>;
}

export const SshMachinesSection: FC<SshMachinesSectionProps> = ({
  machines,
  busy = false,
  onSaveMachine,
  onConnectMachine,
  onDisconnectMachine,
  onDeleteMachine,
}) => {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [sshTarget, setSshTarget] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const close = useCallback(() => {
    setAdding(false);
    setFormError(null);
  }, []);
  const modalRef = useModalFocus<HTMLDivElement>({
    open: adding,
    onClose: close,
  });

  useEffect(() => {
    if (!adding) return;
    queueMicrotask(() => {
      modalRef.current
        ?.querySelector<HTMLInputElement>("[data-modal-initial-focus='true']")
        ?.focus();
    });
  }, [adding, modalRef]);

  const submit = useCallback(async () => {
    const nextLabel = label.trim();
    const nextTarget = sshTarget.trim();
    if (!nextLabel || !nextTarget) {
      setFormError("Name and SSH host are required.");
      return;
    }
    try {
      await onSaveMachine({ label: nextLabel, sshTarget: nextTarget });
      setLabel("");
      setSshTarget("");
      close();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Machine could not be saved.",
      );
    }
  }, [close, label, onSaveMachine, sshTarget]);

  return (
    <section aria-labelledby="ssh-machines-heading" className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2
            id="ssh-machines-heading"
            className="text-[13px] font-medium text-foreground"
          >
            Machines you work on
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Open projects and run agents on another machine over SSH.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="md"
          icon={<IconPlus size={13} />}
          disabled={busy}
          onClick={() => setAdding(true)}
          data-testid="connections-add-machine"
        >
          Add machine
        </Button>
      </div>

      {machines.length === 0 ? (
        <div className="flex min-h-[132px] flex-col items-center justify-center rounded-lg bg-surface-raised px-6 py-6 text-center">
          <IconServer size={28} className="mb-2.5 text-foreground" />
          <p className="text-[13px] text-muted-foreground">
            No SSH machines added yet
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-surface-raised">
          <ul className={SETTINGS_STACK}>
            {machines.map((machine) => (
              <li
                key={machine.id}
                className="flex items-center justify-between gap-4 px-4 py-3.5"
                data-testid={`ssh-machine-${machine.id}`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-foreground">
                    <IconServer size={18} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-medium text-foreground">
                        {machine.label}
                      </p>
                      {machine.connected ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-tone-ok">
                          <IconCheckCircle2 size={11} />
                          Connected
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {machine.sshTarget}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant={machine.connected ? "ghost" : "secondary"}
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      machine.connected
                        ? void onDisconnectMachine(machine.id)
                        : void onConnectMachine(machine.id)
                    }
                    data-testid={`ssh-machine-toggle-${machine.id}`}
                  >
                    {machine.connected ? "Disconnect" : "Connect"}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remove ${machine.label}`}
                    icon={<IconTrash size={14} />}
                    onClick={() => void onDeleteMachine(machine.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding ? (
        <div
          ref={modalRef}
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-overlay-bg p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-ssh-machine-title"
          data-modal="true"
          data-testid="add-ssh-machine-dialog"
          tabIndex={-1}
          onClick={close}
        >
          <div
            className="relative w-[392px] max-w-full rounded-lg border border-border bg-background p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Close add machine dialog"
              icon={<IconX size={14} />}
              className="absolute right-3 top-3 h-7 w-7 p-0"
              onClick={close}
            />
            <h3
              id="add-ssh-machine-title"
              className="text-base font-semibold text-foreground"
            >
              Add SSH machine
            </h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Graft uses your existing OpenSSH config, keys, and host aliases.
            </p>
            <div className="mt-5 space-y-4">
              <label className="block text-[12px] font-medium text-foreground">
                Name
                <Input
                  className="mt-1.5"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. Development server"
                  data-modal-initial-focus="true"
                  data-testid="ssh-machine-label"
                />
              </label>
              <label className="block text-[12px] font-medium text-foreground">
                SSH host
                <Input
                  className="mt-1.5 font-mono"
                  value={sshTarget}
                  onChange={(event) => setSshTarget(event.target.value)}
                  placeholder="hostname or user@hostname"
                  data-testid="ssh-machine-target"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submit();
                  }}
                />
              </label>
            </div>
            {formError ? (
              <p className="mt-3 text-[12px] text-destructive">{formError}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="md" onClick={close}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={busy}
                onClick={() => void submit()}
              >
                Save machine
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};
