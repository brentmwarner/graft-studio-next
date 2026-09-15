import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { browseSshDirectory, type GraftSshMachineSummary } from "~/graftConnections";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import { getBrowseParentPath, hasTrailingPathSeparator } from "~/lib/projectPaths";
import { readNativeApi } from "~/nativeApi";
import { Button } from "./ui/button";
import { DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export function SourceFolderPicker(props: {
  machine?: GraftSshMachineSummary;
  onCancel: () => void;
  onSelect: (path: string) => void;
}) {
  const [requestedPath, setRequestedPath] = useState("~/");
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const connected = !props.machine || props.machine.connected;
  const directory = useQuery({
    queryKey: ["graft", "source-directory", props.machine?.id ?? "local", requestedPath],
    queryFn: () => {
      if (props.machine) return browseSshDirectory(props.machine.id, requestedPath);
      const api = readNativeApi();
      if (!api) throw new Error("The app server is unavailable.");
      return api.filesystem.browse({ partialPath: requestedPath });
    },
    enabled: connected,
    retry: false,
    staleTime: 5_000,
  });
  const currentPath = directory.data?.parentPath;
  const path = draftPath ?? currentPath ?? requestedPath;
  const parentPath = currentPath ? getBrowseParentPath(currentPath) : null;
  const entries = (directory.data?.entries ?? []).filter(
    (entry) => showHidden || !entry.name.startsWith("."),
  );
  const ready = connected && !!currentPath && !directory.isFetching && !directory.isError;
  const edited = draftPath !== null && draftPath.trim() !== currentPath;
  const navigate = (folder: string) => {
    setRequestedPath(
      hasTrailingPathSeparator(folder) ? folder : `${folder}${folder.includes("\\") ? "\\" : "/"}`,
    );
    setDraftPath(null);
    setSelectedPath(null);
  };

  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-5">
        <DialogTitle>Choose a source folder</DialogTitle>
      </DialogHeader>
      <div className="min-h-0 space-y-3 px-5">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (path.trim()) navigate(path.trim());
          }}
        >
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Parent folder"
            disabled={!ready || !parentPath || parentPath === currentPath}
            onClick={() => {
              if (parentPath) navigate(parentPath);
            }}
          >
            <CentralIcon name="arrow-up" className="size-4 text-muted-foreground" />
          </Button>
          <Input
            autoFocus
            aria-label={props.machine ? "Remote folder path" : "Folder path"}
            value={path}
            onChange={(event) => setDraftPath(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 rounded-lg text-[13px] has-focus:border-[#007aff] has-focus:ring-1 has-focus:ring-[#007aff]"
          />
        </form>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={!ready || edited}
          onClick={() => setSelectedPath(null)}
        >
          Select current folder
        </button>
        <div
          className="h-[min(12.5rem,40vh)] overflow-y-auto rounded-xl border border-border"
          aria-busy={directory.isFetching}
        >
          {!connected ? (
            <p role="alert" className="p-4 text-xs text-destructive">
              This computer is disconnected. Reconnect in Settings → Connections.
            </p>
          ) : directory.isFetching ? (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              Loading folders…
            </p>
          ) : directory.isError ? (
            <p role="alert" className="p-4 text-xs text-destructive">
              {directory.error.message}
            </p>
          ) : entries.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              No subfolders. You can use the current folder.
            </p>
          ) : (
            <ul className="py-1">
              {entries.map((entry) => (
                <li key={entry.fullPath}>
                  <button
                    type="button"
                    aria-label={`Folder ${entry.name}`}
                    aria-pressed={selectedPath === entry.fullPath}
                    title="Double-click or press Enter to open"
                    disabled={edited}
                    onClick={() => setSelectedPath(entry.fullPath)}
                    onDoubleClick={() => navigate(entry.fullPath)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        navigate(entry.fullPath);
                      }
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.25 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
                      selectedPath === entry.fullPath && "bg-muted",
                    )}
                  >
                    <CentralIcon
                      name="folder-1"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <DialogFooter className="px-5 pt-3 pb-5 sm:items-center">
        <label className="mr-auto flex w-fit items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          Show hidden folders
        </label>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          variant="prominent"
          disabled={!ready || edited}
          onClick={() => {
            if (!currentPath) return;
            props.onSelect(selectedPath ?? currentPath);
          }}
        >
          Use folder
        </Button>
      </DialogFooter>
    </>
  );
}
