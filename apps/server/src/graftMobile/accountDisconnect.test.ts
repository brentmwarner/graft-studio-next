import { AuthSessionId, type AuthClientSession, type AuthPairingLink } from "@graft/contracts";
import { DateTime, Effect } from "effect";
import { expect, it, vi } from "vitest";

import { revokePairedAccountAccess } from "./accountDisconnect";

it("revokes paired clients and their unused links while preserving local owner sessions", async () => {
  const owner = AuthSessionId.makeUnsafe("owner");
  const client = AuthSessionId.makeUnsafe("phone");
  const now = DateTime.nowUnsafe();
  const sessions: AuthClientSession[] = [owner, client].map((sessionId) => ({
    sessionId,
    subject: sessionId,
    role: sessionId === owner ? "owner" : "client",
    method: "bearer-session-token",
    client: { deviceType: "mobile" },
    issuedAt: now,
    expiresAt: now,
    lastConnectedAt: null,
    connected: true,
    current: false,
  }));
  const links: AuthPairingLink[] = ["owner", "client"].map((role) => ({
    id: role,
    credential: "test",
    role: role as "owner" | "client",
    subject: "test",
    createdAt: now,
    expiresAt: now,
  }));
  const auth = {
    listClientSessions: () => Effect.succeed(sessions),
    listPairingLinks: () => Effect.succeed(links),
    revokeClientSession: vi.fn(() => Effect.succeed(true)),
    revokePairingLink: vi.fn(() => Effect.succeed(true)),
  };
  await Effect.runPromise(revokePairedAccountAccess(auth, owner));
  expect(auth.revokeClientSession).toHaveBeenCalledExactlyOnceWith(owner, client);
  expect(auth.revokePairingLink).toHaveBeenCalledExactlyOnceWith("client");
});
