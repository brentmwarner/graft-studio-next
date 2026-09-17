import type { AuthSessionId } from "@graft/contracts";
import { Effect } from "effect";

import type { ServerAuthShape } from "../auth/Services/ServerAuth";

/** Account changes revoke paired access without invalidating the desktop's local owner session. */
export function revokePairedAccountAccess(
  auth: Pick<
    ServerAuthShape,
    "listClientSessions" | "revokeClientSession" | "listPairingLinks" | "revokePairingLink"
  >,
  currentSessionId: AuthSessionId,
) {
  return Effect.gen(function* () {
    const clients = yield* auth.listClientSessions(currentSessionId);
    for (const client of clients) {
      if (client.role === "client")
        yield* auth.revokeClientSession(currentSessionId, client.sessionId);
    }
    const links = yield* auth.listPairingLinks();
    for (const link of links) {
      if (link.role === "client") yield* auth.revokePairingLink(link.id);
    }
  });
}
