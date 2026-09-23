# Remote Access Setup

Use this when you want to open Graft from another device (phone, tablet, another laptop).

## CLI ↔ Env option map

The Graft CLI accepts the following configuration options, available either as CLI flags or environment variables:

| CLI flag                | Env var               | Notes                              |
| ----------------------- | --------------------- | ---------------------------------- |
| `--mode <web\|desktop>` | `GRAFT_MODE`          | Runtime mode.                      |
| `--port <number>`       | `GRAFT_PORT`          | HTTP/WebSocket port.               |
| `--host <address>`      | `GRAFT_BIND_HOST`     | Bind interface/address.            |
| `--home-dir <path>`     | `GRAFT_HOME`          | Base directory.                    |
| `--dev-url <url>`       | `VITE_DEV_SERVER_URL` | Dev web URL redirect/proxy target. |
| `--no-browser`          | `GRAFT_NO_BROWSER`    | Disable auto-open browser.         |
| `--auth-token <token>`  | `GRAFT_AUTH_TOKEN`    | WebSocket auth token.              |

> TIP: Use the `--help` flag to see all available options and their descriptions.

## Computer names in mobile apps

The computer filters and project suffixes use the desktop machine's name: the
macOS Computer Name, Linux hostname, or Windows `COMPUTERNAME`. They do not use
the launch directory or account username. Name discovery runs when the host starts.

For a custom display name, set `GRAFT_MACHINE_NAME` in the desktop/server launch
environment (for example, `omarchy` or `MacBook Pro`) and restart the host.
This changes only the display label; environment IDs and pairings stay the same.
Updated mobile clients refresh existing paired labels from host snapshots and
keep the last snapshot's name available offline, without pairing again.

## Security First

- Always set `--auth-token` before exposing the server outside localhost.
- Treat the token like a password.
- Prefer binding to trusted interfaces (LAN IP or Tailnet IP) instead of opening all interfaces unless needed.

## 1) Build + run server for remote access

Remote access should use the built web app (not local Vite redirect mode).

```bash
bun run build
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- --host 0.0.0.0 --port 3773 --auth-token "$TOKEN" --no-browser
```

Then open on your phone:

`http://<your-machine-ip>:3773`

Example:

`http://192.168.1.42:3773`

Notes:

- `--host 0.0.0.0` listens on all IPv4 interfaces.
- `--no-browser` prevents local auto-open, which is usually better for headless/remote sessions.
- Ensure your OS firewall allows inbound TCP on the selected port.

## 2) Tailnet / Tailscale access

If you use Tailscale, you can bind directly to your Tailnet address.

```bash
TAILNET_IP="$(tailscale ip -4)"
TOKEN="$(openssl rand -hex 24)"
bun run --cwd apps/server start -- --host "$(tailscale ip -4)" --port 3773 --auth-token "$TOKEN" --no-browser
```

Open from any device in your tailnet:

`http://<tailnet-ip>:3773`

You can also bind `--host 0.0.0.0` and connect through the Tailnet IP, but binding directly to the Tailnet IP limits exposure.
