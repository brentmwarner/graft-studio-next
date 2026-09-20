import type { GraftSessionCredential } from "@graft/mobile-contract";
import { memo, useEffect } from "react";
import { useGraftSession } from "./useGraftSession";
import { useInboxReadState } from "./useInboxReadState";
import type { ThreadReadState } from "./threadActivity";

export type MachineController = ReturnType<typeof useGraftSession> & {
  readonly reads: ThreadReadState;
};

/** Mounted once per credential; changing inbox filters does not reconnect sockets. */
export const MachineRuntime = memo(function MachineRuntime({
  credential,
  visibleThreadId,
  onUpdate,
}: {
  readonly credential: GraftSessionCredential;
  readonly visibleThreadId?: string;
  readonly onUpdate: (credential: GraftSessionCredential, controller: MachineController) => void;
}) {
  const controller = useGraftSession(credential);
  const paired = controller.state.status === "paired" ? controller.state : null;
  const reads = useInboxReadState(
    credential.environmentId,
    paired?.snapshot ?? null,
    paired?.liveEvents,
    visibleThreadId,
  );
  useEffect(() => {
    onUpdate(credential, { ...controller, reads });
  }, [credential, controller, reads, onUpdate]);
  return null;
});
