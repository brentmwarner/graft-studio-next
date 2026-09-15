import "../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ConnectedCreateProjectDialog } from "./ConnectedCreateProjectDialog";
import { SshProjectDialog } from "./SshProjectDialog";
import type { GraftSshMachineSummary } from "~/graftConnections";

const api = vi.hoisted(() => ({
  listSshMachines: vi.fn(),
  browseSshDirectory: vi.fn(),
  addSshProject: vi.fn(),
  saveSshMachine: vi.fn(),
  connectSshMachine: vi.fn(),
  browseLocal: vi.fn(),
}));
vi.mock("~/graftConnections", () => ({
  ...api,
  SSH_MACHINES_QUERY_KEY: ["graft", "ssh-machines"],
  sshProjectsQueryKey: (id: string) => ["graft", "ssh-projects", id],
}));
vi.mock("../nativeApi", () => ({
  readNativeApi: () => ({
    projects: { onProvisionProgress: () => () => undefined },
    filesystem: { browse: api.browseLocal },
  }),
}));
const machine: GraftSshMachineSummary = {
  id: "remote-one",
  label: "Omarchy",
  sshTarget: "dev@omarchy",
  connected: true,
  effectiveHostname: "omarchy",
  environmentLabel: "Omarchy",
  daemonVersion: "0.2.2",
};
const clients: QueryClient[] = [];
function client() {
  const value = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(value);
  return value;
}
afterEach(() => {
  for (const value of clients.splice(0)) value.clear();
  vi.resetAllMocks();
});

async function mountConnected() {
  api.listSshMachines.mockResolvedValue({ machines: [machine] });
  const onSubmit = vi.fn();
  await render(
    <QueryClientProvider client={client()}>
      <ConnectedCreateProjectDialog
        open
        githubProvisioningAvailable
        spaces={[]}
        activeSpaceId={null}
        defaultCloneParent="/local"
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />
    </QueryClientProvider>,
  );
  return onSubmit;
}

it("selects a remote computer in Source folders and opens its browser only after Add", async () => {
  api.browseSshDirectory.mockResolvedValue({
    parentPath: "/home/dev",
    entries: [{ name: "work", fullPath: "/home/dev/work" }],
  });
  const localSubmit = await mountConnected();
  await page.getByRole("button", { name: "Computer", exact: true }).click();
  await expect.element(page.getByText("Remote devices", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("menuitem", { name: "Add remote" })).toBeVisible();
  await page.getByRole("menuitemradio", { name: "Omarchy" }).click();
  await expect.element(page.getByRole("heading", { name: "Create project" })).toBeVisible();
  expect(api.browseSshDirectory).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Add source folder" }).click();
  await expect.element(page.getByRole("heading", { name: "Choose a source folder" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Folder work" })).toBeVisible();
  expect(api.browseSshDirectory).toHaveBeenCalledWith("remote-one", "~/");
  expect(api.browseLocal).not.toHaveBeenCalled();
  expect(localSubmit).not.toHaveBeenCalled();
});

it.each([false, true])(
  "uses a remote folder, then creates the project (open folder: %s)",
  async (openFolder) => {
    api.browseSshDirectory.mockImplementation(async (_id: string, path: string) =>
      path === "~/"
        ? { parentPath: "/home/dev", entries: [{ name: "work", fullPath: "/home/dev/work" }] }
        : { parentPath: "/home/dev/work", entries: [] },
    );
    api.addSshProject.mockResolvedValue({
      project: { id: "project-one", name: "work", path: "/home/dev/work" },
    });
    const onOpenChange = vi.fn();
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await render(
      <QueryClientProvider client={queryClient}>
        <SshProjectDialog machine={machine} open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );
    await page.getByRole("button", { name: "Add source folder" }).click();
    const folder = page.getByRole("button", { name: "Folder work" });
    if (openFolder) {
      await folder.dblClick();
      await expect
        .element(page.getByText("No subfolders. You can use the current folder."))
        .toBeVisible();
    } else {
      await folder.click();
    }
    await page.getByRole("button", { name: "Use folder", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Project folder path" }))
      .toHaveValue("/home/dev/work");
    expect(api.addSshProject).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.addSshProject).toHaveBeenCalledWith("remote-one", {
      commandId: expect.any(String),
      projectId: expect.any(String),
      path: "/home/dev/work",
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["graft", "ssh-projects", "remote-one"] });
  },
);

it("does not select stale directory data after navigation fails", async () => {
  api.browseSshDirectory.mockImplementation(async (_id: string, path: string) => {
    if (path === "~/") return { parentPath: "/home/dev", entries: [] };
    throw new Error("Permission denied on the remote computer.");
  });
  await render(
    <QueryClientProvider client={client()}>
      <SshProjectDialog machine={machine} open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  await page.getByRole("button", { name: "Add source folder" }).click();
  await expect.element(page.getByRole("button", { name: "Use folder" })).toBeEnabled();
  const path = page.getByRole("textbox", { name: "Remote folder path" });
  await path.fill("/private");
  await expect.element(page.getByRole("button", { name: "Use folder" })).toBeDisabled();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("alert")).toHaveTextContent("Permission denied");
  await expect.element(page.getByRole("button", { name: "Use folder" })).toBeDisabled();
  expect(api.addSshProject).not.toHaveBeenCalled();
});

it("keeps cancellation local to the browser and clears the folder when switching computers", async () => {
  api.browseLocal.mockResolvedValue({
    parentPath: "/Users/dev",
    entries: [{ name: "local-work", fullPath: "/Users/dev/local-work" }],
  });
  api.browseSshDirectory.mockResolvedValue({ parentPath: "/home/dev", entries: [] });
  const localSubmit = await mountConnected();
  await page.getByRole("button", { name: "Add source folder" }).click();
  await page.getByRole("button", { name: "Folder local-work" }).click();
  await page.getByRole("button", { name: "Use folder" }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Project folder path" }))
    .toHaveValue("/Users/dev/local-work");
  await page.getByRole("button", { name: "Change source folder" }).click();
  await page
    .getByRole("dialog", { name: "Choose a source folder" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect
    .element(page.getByRole("textbox", { name: "Project folder path" }))
    .toHaveValue("/Users/dev/local-work");
  await page.getByRole("button", { name: "Computer", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Omarchy" }).click();
  await expect.element(page.getByRole("textbox", { name: "Project folder path" })).toHaveValue("");
  await page.getByRole("button", { name: "Computer", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "This computer" }).click();
  await expect.element(page.getByRole("textbox", { name: "Project folder path" })).toHaveValue("");
  expect(localSubmit).not.toHaveBeenCalled();
  expect(api.addSshProject).not.toHaveBeenCalled();
});

it("adds a remote from the computer menu and connects it before folder selection", async () => {
  await mountConnected();
  const saved = { ...machine, id: "new-remote", label: "Build machine", connected: false };
  api.saveSshMachine.mockImplementation(async () => {
    api.listSshMachines.mockResolvedValue({ machines: [machine, saved] });
    return { machine: saved };
  });
  api.connectSshMachine.mockImplementation(async () => {
    const connected = { ...saved, connected: true };
    api.listSshMachines.mockResolvedValue({ machines: [machine, connected] });
    return { machine: connected };
  });
  await page.getByRole("button", { name: "Computer", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add remote" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a computer" });
  await dialog.getByRole("textbox", { name: "SSH address" }).fill("dev@build");
  await dialog.getByRole("textbox", { name: "Name" }).fill("Build machine");
  await dialog.getByRole("button", { name: "Add computer", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Computer", exact: true }))
    .toHaveTextContent("Build machine");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Add source folder" })).toBeEnabled();
  expect(api.connectSshMachine).toHaveBeenCalledWith("new-remote");
  expect(api.addSshProject).not.toHaveBeenCalled();
});
