import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  listSshMachines,
  listSshProjects,
  SSH_MACHINES_QUERY_KEY,
  sshProjectsQueryKey,
  type GraftSshMachineSummary,
} from "~/graftConnections";
import { CentralIcon } from "~/lib/central-icons";
import { SshProjectDialog } from "./SshProjectDialog";
import { Button } from "./ui/button";

function ComputerProjects({ machine }: { machine: GraftSshMachineSummary }) {
  const [adding, setAdding] = useState(false);
  const projects = useQuery({
    queryKey: sshProjectsQueryKey(machine.id),
    queryFn: () => listSshProjects(machine.id),
    enabled: machine.connected,
    staleTime: 5_000,
    refetchInterval: machine.connected ? 10_000 : false,
    retry: false,
  });
  return (
    <section aria-label={`Projects on ${machine.label}`} className="mt-4 px-2">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <CentralIcon name="macbook" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{machine.label}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Add project on ${machine.label}`}
          disabled={!machine.connected}
          onClick={() => setAdding(true)}
        >
          <CentralIcon name="plus-small" className="size-3.5" />
        </Button>
      </div>
      {!machine.connected ? (
        <p className="px-2 text-xs text-muted-foreground">Not connected</p>
      ) : projects.isPending ? (
        <p className="px-2 text-xs text-muted-foreground">Loading projects…</p>
      ) : projects.isError ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          Could not load remote projects.
        </p>
      ) : projects.data.projects.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">No projects yet</p>
      ) : (
        <ul className="space-y-1">
          {projects.data.projects.map((project) => (
            <li
              key={project.id}
              className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-[13px]"
              title={`${project.path} on ${machine.label}`}
            >
              <CentralIcon name="folder-1" className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{project.name}</span>
            </li>
          ))}
        </ul>
      )}
      {adding ? <SshProjectDialog machine={machine} open onOpenChange={setAdding} /> : null}
    </section>
  );
}

export function SshProjectsSidebar() {
  const machines = useQuery({
    queryKey: SSH_MACHINES_QUERY_KEY,
    queryFn: listSshMachines,
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: false,
  });
  return (
    <>
      {machines.data?.machines.map((machine) => (
        <ComputerProjects key={machine.id} machine={machine} />
      ))}
    </>
  );
}
