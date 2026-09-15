import { useQuery } from "@tanstack/react-query";
import { useState, type ComponentProps } from "react";

import { listSshMachines, SSH_MACHINES_QUERY_KEY } from "~/graftConnections";
import { CentralIcon } from "~/lib/central-icons";
import { AddSshComputerDialog } from "./AddSshComputerDialog";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { SshProjectDialog } from "./SshProjectDialog";
import { ComposerPickerMenuPopup } from "./chat/ComposerPickerMenuPopup";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "./ui/menu";

export function ConnectedCreateProjectDialog(props: ComponentProps<typeof CreateProjectDialog>) {
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [addingRemote, setAddingRemote] = useState(false);
  const machines = useQuery({
    queryKey: SSH_MACHINES_QUERY_KEY,
    queryFn: listSshMachines,
    enabled: props.open,
    refetchInterval: props.open ? 5_000 : false,
    staleTime: 5_000,
    retry: false,
  });
  const selected = machines.data?.machines.find((machine) => machine.id === selectedMachineId);
  const onOpenChange = (open: boolean) => {
    props.onOpenChange(open);
    if (!open) {
      setSelectedMachineId(null);
      setAddingRemote(false);
    }
  };
  const picker = (
    <>
      <Menu>
        <MenuTrigger
          aria-label="Computer"
          className="inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="shrink-0 text-muted-foreground">Add a folder on</span>
          <span className="truncate">{selected?.label ?? "this computer"}</span>
          <CentralIcon name="chevron-down-small" className="size-3.5 shrink-0" />
        </MenuTrigger>
        <ComposerPickerMenuPopup align="center" className="w-52 rounded-2xl">
          <MenuRadioGroup
            value={selected?.id ?? "local"}
            onValueChange={(value) => setSelectedMachineId(value === "local" ? null : value)}
          >
            <MenuRadioItem value="local" className="min-h-7 text-[13px]">
              <CentralIcon name="macbook" className="size-4" />
              This computer
            </MenuRadioItem>
            <MenuGroup>
              <MenuGroupLabel className="pt-2 text-xs text-muted-foreground">
                Remote devices
              </MenuGroupLabel>
              {machines.data?.machines.map((machine) => (
                <MenuRadioItem key={machine.id} value={machine.id} className="min-h-7 text-[13px]">
                  <span className="border-b-2 border-dotted border-current pb-0.5">
                    <CentralIcon name="macbook" className="size-4" />
                  </span>
                  <span className="min-w-0 truncate">{machine.label}</span>
                </MenuRadioItem>
              ))}
              {machines.isError ? (
                <p role="alert" className="px-2 py-1 text-xs text-destructive">
                  Could not load computers.
                </p>
              ) : null}
              {machines.isPending ? (
                <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
                  Loading computers…
                </p>
              ) : null}
            </MenuGroup>
          </MenuRadioGroup>
          <MenuItem className="min-h-7 text-[13px]" onClick={() => setAddingRemote(true)}>
            <CentralIcon name="plus-medium" className="size-4" />
            Add remote
          </MenuItem>
        </ComposerPickerMenuPopup>
      </Menu>
      {addingRemote ? (
        <AddSshComputerDialog
          open
          onOpenChange={setAddingRemote}
          onAdded={(machine) => setSelectedMachineId(machine.id)}
        />
      ) : null}
    </>
  );

  if (selected)
    return (
      <SshProjectDialog
        key={selected.id}
        machine={selected}
        open={props.open}
        onOpenChange={onOpenChange}
        computerPicker={picker}
      />
    );
  return <CreateProjectDialog {...props} onOpenChange={onOpenChange} computerPicker={picker} />;
}
