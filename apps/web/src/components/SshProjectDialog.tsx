import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  addSshProject,
  connectSshMachine,
  SSH_MACHINES_QUERY_KEY,
  sshProjectsQueryKey,
  type GraftSshMachineSummary,
} from "~/graftConnections";
import { newCommandId, newProjectId } from "~/lib/utils";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { Button } from "./ui/button";

export function SshProjectDialog(props: {
  machine: GraftSshMachineSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  computerPicker?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const connect = useMutation({
    mutationFn: () => connectSshMachine(props.machine.id),
    onSuccess: ({ machine }) => {
      queryClient.setQueryData<{ machines: GraftSshMachineSummary[] }>(
        SSH_MACHINES_QUERY_KEY,
        (current) => ({
          machines: (current?.machines ?? []).map((saved) =>
            saved.id === machine.id ? machine : saved,
          ),
        }),
      );
      void queryClient.invalidateQueries({ queryKey: SSH_MACHINES_QUERY_KEY });
    },
  });
  return (
    <CreateProjectDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      remoteMachine={props.machine}
      computerPicker={props.computerPicker}
      folderAction={
        !props.machine.connected ? (
          <div className="space-y-2 text-center">
            <Button
              variant="secondary"
              shape="capsule"
              size="sm"
              disabled={connect.isPending}
              onClick={() => connect.mutate()}
            >
              {connect.isPending ? "Connecting…" : "Connect"}
            </Button>
            {connect.isError ? (
              <p role="alert" className="text-xs text-destructive">
                {connect.error.message}
              </p>
            ) : null}
          </div>
        ) : undefined
      }
      githubProvisioningAvailable={false}
      spaces={[]}
      activeSpaceId={null}
      defaultCloneParent=""
      onSubmit={async (value) => {
        if (value.source !== "local") throw new Error("Choose a folder on the remote computer.");
        await addSshProject(props.machine.id, {
          commandId: newCommandId(),
          projectId: newProjectId(),
          path: value.workspaceRoot,
        });
        await queryClient.invalidateQueries({ queryKey: sshProjectsQueryKey(props.machine.id) });
      }}
    />
  );
}
