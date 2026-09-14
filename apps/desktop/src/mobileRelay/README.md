# Graft mobile relay

This restores the account login, encrypted credential store, relay registration,
and relay uplink from the legacy `graft-studio` desktop. The shared wire format
lives in `packages/mobile-contract/src/relay.ts`.

Enable connections and sign in to Graft in **Settings → Connections**. The desktop
opens an outbound WebSocket to the existing managed relay at `api.graftapp.io`.
Pairing then advertises the relay's HTTPS environment URL, which works over
cellular and other Wi-Fi networks without Tailscale or router configuration.
The computer must remain online; the existing keep-awake setting is available.

Credentials are encrypted with Electron safeStorage in this app profile's
`mobile-relay/secrets.json`. They are not sent to the renderer, backend, or agent
processes. Signing out disconnects the uplink and clears both stored credentials.

The uplink forwards traffic through the dedicated mobile gateway, whose route
filter excludes owner APIs. The desktop publishes only connection status and
public endpoint URLs to the authenticated backend. A ten-second heartbeat renews
a thirty-second status lease, preventing an abandoned uplink from being offered
in new pairing codes. The backend preserves the relay environment path after
pairing. Without a connected relay, local pairing prefers LAN over Tailscale.

Focused tests cover the inherited login, storage, registration and transport,
plus controller startup, disabled access, gateway restart, sign-out races,
protocol validation, status expiry and pairing endpoint selection. Browser tests
check that the displayed network requirements match the QR code itself.
