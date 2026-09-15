# Graft mobile contract

This package is the stable, versioned compatibility boundary between the Graft
iOS and Android clients and the Graft-based Graft host. Mobile clients must
depend on this package rather than Graft's internal server or web contracts.

The protocol version changes only when a compatible host cannot continue to
serve an existing released mobile client. Fixtures under `protocol-fixtures/`
are canonical; the iOS copy is checked by `bun run check:ios-fixtures`.
