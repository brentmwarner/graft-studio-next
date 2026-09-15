import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { AddSshComputerDialog } from "../AddSshComputerDialog";
import {
  connectSshMachine,
  deleteSshMachine,
  disconnectSshMachine,
  listSshMachines,
  listSshProjects,
  sshProjectsQueryKey,
  type GraftSshMachineSummary,
} from "~/graftConnections";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import { SettingsCard } from "./SettingsPanelPrimitives";
import { SshProjectDialog } from "../SshProjectDialog";

const SSH_QUERY_KEY = ["graft", "ssh-machines"] as const;

type MachineAction = "connect" | "disconnect" | "remove";

function SshComputerRow({ machine }: { machine: GraftSshMachineSummary }) {
  const queryClient = useQueryClient();
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const projects = useQuery({
    queryKey: sshProjectsQueryKey(machine.id),
    queryFn: () => listSshProjects(machine.id),
    enabled: machine.connected,
    staleTime: 5_000,
    retry: false,
  });
  const action = useMutation({
    mutationFn: async (operation: MachineAction): Promise<void> => {
      switch (operation) {
        case "connect":
          await connectSshMachine(machine.id);
          return;
        case "disconnect":
          await disconnectSshMachine(machine.id);
          return;
        case "remove":
          await deleteSshMachine(machine.id);
          return;
        default: {
          const exhaustive: never = operation;
          throw new Error(`Unknown computer action: ${exhaustive}`);
        }
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SSH_QUERY_KEY }),
  });
  const connecting = action.isPending && action.variables === "connect";
  const status = connecting
    ? "Connecting…"
    : machine.connected
      ? "Connected"
      : action.isError
        ? "Connection error"
        : "Not connected";

  return (
    <li className="px-4 py-4" data-testid={`ssh-computer-${machine.id}`}>
      <div className="flex items-center gap-3.5">
        <CentralIcon name="macbook" className="size-6 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">{machine.label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5" role="status">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 rounded-full",
                  machine.connected ? "bg-emerald-500" : "bg-muted-foreground/50",
                )}
              />
              {status}
            </span>
            <span aria-hidden="true">·</span>
            <span className="break-all">{machine.sshTarget}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {machine.connected ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={action.isPending}
              aria-label={`Add project on ${machine.label}`}
              onClick={() => setProjectDialogOpen(true)}
            >
              Add project
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={action.isPending}
            aria-label={`${machine.connected ? "Disconnect from" : "Connect to"} ${machine.label}`}
            onClick={() => action.mutate(machine.connected ? "disconnect" : "connect")}
          >
            {connecting ? (
              <CentralIcon
                name="loader"
                className="size-3.5 animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {action.isPending
              ? connecting
                ? "Connecting…"
                : "Updating…"
              : machine.connected
                ? "Disconnect"
                : action.isError
                  ? "Retry"
                  : "Connect"}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={action.isPending}
            aria-label={`Remove ${machine.label}`}
            title={`Remove ${machine.label}`}
            onClick={() => action.mutate("remove")}
          >
            <CentralIcon name="trash-can" className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
      {machine.connected && projects.data && projects.data.projects.length > 0 ? (
        <ul className="mt-3 space-y-2 border-t border-border pt-3">
          {projects.data.projects.map((project) => (
            <li key={project.id} className="flex min-w-0 items-center gap-2 text-xs">
              <CentralIcon name="folder-1" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{project.name}</span>
              <span className="ml-auto min-w-0 truncate text-muted-foreground" title={project.path}>
                {project.path}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {projectDialogOpen ? (
        <SshProjectDialog machine={machine} open onOpenChange={setProjectDialogOpen} />
      ) : null}
      {action.isError ? (
        <p
          role="alert"
          className="mt-3 break-words rounded-lg bg-destructive/5 px-3 py-2.5 text-xs leading-relaxed text-destructive"
        >
          {action.error instanceof Error
            ? action.error.message
            : "The connection could not be updated. Try again."}
        </p>
      ) : connecting ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Connecting over SSH and preparing the remote workspace. First-time setup can take a
          minute.
        </p>
      ) : null}
    </li>
  );
}

export function SshConnectionsPanel({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const machinesQuery = useQuery({
    queryKey: SSH_QUERY_KEY,
    queryFn: listSshMachines,
    enabled: active,
    staleTime: 5_000,
    refetchInterval: active ? 5_000 : false,
  });
  const machines = machinesQuery.data?.machines ?? [];

  return (
    <section
      hidden={!active}
      aria-labelledby="ssh-computers-heading"
      className="mb-9"
      data-testid="ssh-connections-panel"
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id="ssh-computers-heading" className="text-[13px] font-medium text-foreground">
          Computers you can connect to
        </h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setOpen(true);
          }}
        >
          Add computer
        </Button>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        Connect to another computer over SSH using your existing keys and SSH configuration.
      </p>
      {machinesQuery.isError ? (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-destructive/20 px-4 py-3 text-xs text-destructive"
        >
          <p>
            {machinesQuery.error instanceof Error
              ? machinesQuery.error.message
              : "Could not load computers."}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void machinesQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      <SettingsCard className="bg-transparent">
        {machines.length > 0 ? (
          <ul className="divide-y divide-border">
            {machines.map((machine) => (
              <SshComputerRow key={machine.id} machine={machine} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center px-6 py-9 text-center">
            <CentralIcon name="macbook" className="mb-3 size-7 text-muted-foreground" />
            <p className="text-[13px] font-medium text-foreground" role="status">
              {machinesQuery.isPending
                ? "Loading computers…"
                : "Your remote computers, in one place"}
            </p>
            <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Add a Linux computer to connect to its workspace from here.
            </p>
          </div>
        )}
      </SettingsCard>
      {open ? <AddSshComputerDialog open onOpenChange={setOpen} /> : null}
    </section>
  );
}
