# Connections

Open **Settings → Connections** to manage remote computers and paired mobile devices.

## Connect over SSH

1. Select **Add computer**.
2. Enter an SSH config alias (for example, `workstation`) or a remote username and host (`dev@workstation`). The display name is optional.
3. Select **Add computer**, then **Connect** beside the computer.

Graft uses the system OpenSSH client and your existing SSH configuration, keys, and agent. Set custom ports, jump hosts, and identity files in `~/.ssh/config`; the address field accepts a host or `user@host`, not command-line options. If you omit a username, OpenSSH uses the user configured for the host or your local username.

The remote service currently supports **Linux x64 with glibc**. The remote computer needs Node.js **22.19+, 23.11+, 24.10+, or a newer major release**, available to non-interactive SSH commands. Password and passphrase prompts must be completed outside the app; load encrypted keys into your SSH agent first.

On first connection, Graft copies its bundled host service to the remote computer and installs it under `~/.local/share/graft/host/installation` (or `XDG_DATA_HOME`). It starts a loopback-only service, opens an SSH tunnel, checks the service identity, and enrolls a desktop session. The remote host currently advertises project and thread capabilities. Connecting does not itself launch a provider or a remote task.

**Disconnect** closes the local tunnel. **Remove** forgets the saved computer and deletes its local session credential; remote session revocation is best-effort when the host is reachable. Disconnecting does not uninstall the remote service or stop its existing work.

## Add a project on a connected computer

1. Select **Add project** in the sidebar. Under **Source folders**, open **Add a folder on this computer** and choose a computer under **Remote devices**. **Add remote** opens the SSH setup dialog. You can also use **Add project** beside a connected computer in Settings.
2. Select **Add** to open **Choose a source folder**. Click a folder to select it, double-click or press Enter to open it, or enter a path and press Enter. Use the up arrow to navigate to the parent folder.
3. Select **Use folder** to return to the form, then **Create project** to register it on that computer. The form and folder browser share one modal. **Cancel**, **Close**, or **Escape** returns to the form without changing its values and puts focus back on **Add** or **Change**.

The folder must already exist. Adding the same folder again reuses its existing project, including when reached through a symlink. Saved projects appear under the computer in the sidebar and in Connections. They remain on the remote host after disconnecting; folders are not copied to this computer.

Host 0.2.2 supports browsing and registering remote projects and listing remote threads. Remote task execution and terminal sessions are not yet implemented in this adapter; a connected status does not imply those capabilities. Reconnect an older host to install the updated project browser.

## Troubleshooting

Errors remain beside the affected computer. Correct the issue and select **Retry**.

| Error                                  | What to check                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine could not be reached / timeout | Wake the remote machine, check its address and SSH service, and connect both computers to the required network or VPN. An offline Tailscale peer cannot accept SSH. |
| Authentication failed                  | Use the remote account's username. Verify the same address in Terminal and load your SSH key into the agent.                                                        |
| Host identity could not be verified    | Connect in Terminal to inspect and verify the host key. Resolve a changed key only after checking the machine's identity.                                           |
| Node.js required                       | Install a supported Node.js version and ensure `ssh user@host node --version` works.                                                                                |
| Remote host package missing            | Reinstall the desktop app. For source development, run `bun run --cwd apps/host pack:linux-x64` from the repository root.                                           |
| Remote service could not start         | Run `graft-host diagnostics --json` on the remote machine; check its runtime, disk space, and permissions.                                                          |

The app preserves OpenSSH host-key verification and does not store SSH private keys. Desktop session credentials remain in the server's private secrets directory and are not returned by the computer-list API.

## Paired devices

Use **Add device** to pair Graft Mobile. **Connection options** controls incoming access and keep-awake behavior. Expand **Connection details** for detected addresses, refresh, and diagnostic copying. These options are separate from outgoing SSH connections.

In the signed-in desktop app, **Add device → Get started** connects the Graft relay before creating the QR code. Scan it in Graft Mobile. The phone can use Wi-Fi or cellular; Tailscale is not required. If relay setup fails, retry after resolving the displayed error. Graft does not substitute a LAN address for that pairing attempt.

The host saves its relay credential and connection settings across restarts and updates. The phone keeps the same relay address even when the desktop's internal server port changes. Explicit account sign-out, account changes, device revocation, or session expiry still require pairing again. The legacy-to-0.9.0 migration does not activate old mobile credentials, so those devices need one new pairing.

The computer must remain running and reachable. Enable **Keep host awake** if it should stay available while you use the phone. Browser/headless hosts and development desktops without a Graft account retain local pairing and require a reachable LAN, Tailnet, or configured public address.
