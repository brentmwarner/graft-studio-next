import "../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SshConnectionsPanel } from "./SshConnectionsPanel";
import type { GraftSshMachineSummary } from "~/graftConnections";

const api = vi.hoisted(() => ({
  listSshMachines: vi.fn(),
  saveSshMachine: vi.fn(),
  connectSshMachine: vi.fn(),
  disconnectSshMachine: vi.fn(),
  deleteSshMachine: vi.fn(),
  listSshProjects: vi.fn(),
  addSshProject: vi.fn(),
  browseSshDirectory: vi.fn(),
  SSH_MACHINES_QUERY_KEY: ["graft", "ssh-machines"],
  sshProjectsQueryKey: (id: string) => ["graft", "ssh-projects", id],
}));
vi.mock("~/graftConnections", () => api);
const clients: QueryClient[] = [];
const machine: GraftSshMachineSummary = {
  id: "computer-one",
  label: "Work computer",
  sshTarget: "dev@workstation",
  connected: false,
  effectiveHostname: null,
  environmentLabel: null,
  daemonVersion: null,
};

async function mount(machines: GraftSshMachineSummary[] = [machine]) {
  api.listSshMachines.mockResolvedValue({ machines });
  api.listSshProjects.mockResolvedValue({ projects: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <SshConnectionsPanel active />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.resetAllMocks();
});

it("adds a computer with its SSH address as the default name", async () => {
  const mounted = await mount([]);
  const saved = { ...machine, label: "dev@workstation" };
  api.saveSshMachine.mockImplementation(async () => {
    api.listSshMachines.mockResolvedValue({ machines: [saved] });
    return { machine: saved };
  });
  await mounted.getByRole("button", { name: "Add computer", exact: true }).click();
  const dialog = mounted.getByRole("dialog", { name: "Add a computer" });
  await expect.element(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "SSH address" }).fill("dev@workstation");
  await dialog.getByRole("button", { name: "Add computer", exact: true }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(api.saveSshMachine).toHaveBeenCalledWith({
    label: "dev@workstation",
    sshTarget: "dev@workstation",
  });
  await expect
    .element(mounted.getByRole("button", { name: "Connect to dev@workstation" }))
    .toBeVisible();
});

it("shows connection progress, prevents duplicate attempts, and retains actionable errors", async () => {
  let rejectConnection!: (error: Error) => void;
  const connecting = new Promise<{ machine: GraftSshMachineSummary }>((_resolve, reject) => {
    rejectConnection = reject;
  });
  api.connectSshMachine.mockReturnValue(connecting);
  const mounted = await mount();
  const button = mounted.getByRole("button", { name: "Connect to Work computer" });
  await button.click();
  await expect.element(button).toBeDisabled();
  await expect.element(mounted.getByText("Connecting…", { exact: true }).first()).toBeVisible();
  await expect
    .element(mounted.getByRole("button", { name: "Remove Work computer" }))
    .toBeDisabled();
  rejectConnection(new Error("Check the remote username and load your SSH key into the agent."));
  await expect.element(mounted.getByRole("alert")).toHaveTextContent("Check the remote username");
  await expect.element(button).toBeEnabled();
  await expect.element(button).toHaveTextContent("Retry");
  expect(api.connectSshMachine).toHaveBeenCalledOnce();
});

it("shows a successful connection and reports failed disconnects in the same row", async () => {
  api.connectSshMachine.mockImplementation(async () => {
    const connected = { ...machine, connected: true };
    api.listSshMachines.mockResolvedValue({ machines: [connected] });
    return { machine: connected };
  });
  const mounted = await mount();
  await mounted.getByRole("button", { name: "Connect to Work computer" }).click();
  await expect.element(mounted.getByText("Connected", { exact: true })).toBeVisible();
  api.disconnectSshMachine.mockRejectedValue(
    new Error("The SSH process did not exit after disconnecting."),
  );
  await mounted.getByRole("button", { name: "Disconnect from Work computer" }).click();
  await expect.element(mounted.getByRole("alert")).toHaveTextContent("did not exit");
});
