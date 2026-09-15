import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  saveSshMachine,
  SSH_MACHINES_QUERY_KEY,
  type GraftSshMachineSummary,
} from "~/graftConnections";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

export function AddSshComputerDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: (machine: GraftSshMachineSummary) => void;
}) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [sshTarget, setSshTarget] = useState("");
  const id = useId();
  const save = useMutation({
    mutationFn: () =>
      saveSshMachine({ label: label.trim() || sshTarget.trim(), sshTarget: sshTarget.trim() }),
    onSuccess: ({ machine }) => {
      queryClient.setQueryData<{ machines: GraftSshMachineSummary[] }>(
        SSH_MACHINES_QUERY_KEY,
        (current) => ({ machines: [...(current?.machines ?? []), machine] }),
      );
      onAdded?.(machine);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: SSH_MACHINES_QUERY_KEY });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!save.isPending) onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-[420px] rounded-2xl" bottomStickOnMobile={false}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (sshTarget.trim() && !save.isPending) save.mutate();
          }}
        >
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-base">Add a computer</DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-relaxed">
              Connect securely over SSH. Use a host from your SSH config or enter user@hostname.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 pb-3">
            <div className="space-y-1.5">
              <label htmlFor={`${id}-target`} className="text-xs font-medium">
                SSH address
              </label>
              <Input
                id={`${id}-target`}
                autoFocus
                value={sshTarget}
                onChange={(event) => setSshTarget(event.target.value)}
                placeholder="user@hostname"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={255}
                required
                disabled={save.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-label`} className="text-xs font-medium">
                Name <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id={`${id}-label`}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Work computer"
                maxLength={120}
                disabled={save.isPending}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Requires Linux x64 and Node.js 22.19+ or 24.10+. Synara sets up the remote service
              when you connect. Your SSH keys stay on this computer.
            </p>
            {save.isError ? (
              <p role="alert" className="text-xs leading-relaxed text-destructive">
                {save.error.message}
              </p>
            ) : null}
          </div>
          <DialogFooter className="px-6 pb-6 pt-3">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!sshTarget.trim() || save.isPending}>
              {save.isPending ? "Adding…" : "Add computer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
