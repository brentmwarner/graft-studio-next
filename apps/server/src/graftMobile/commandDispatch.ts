import type { GraftMobileCommand } from "@graft/mobile-contract";
import { Effect, type Scope } from "effect";

export const MOBILE_CONCURRENT_READS = 8;

function isIndependentRead(command: GraftMobileCommand): boolean {
  switch (command.type) {
    case "project.list":
    case "thread.list":
    case "thread.open":
    case "models.list":
    case "composer.commands":
    case "composer.skill.read":
    case "files.resolve":
    case "file.read":
    case "diff.get":
    case "cursor.replay":
    case "snapshot.get":
      return true;
    case "thread.create":
    case "thread.set_model":
    case "thread.set_approval":
    case "turn.start":
    case "turn.cancel":
    case "turn.steer":
    case "approval.resolve":
    case "question.resolve":
      return false;
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

/** One connection's read budget. Mutations still finish in receive order;
 * discovery/file reads must not hold up commands or heartbeat handling.
 * Reject excess reads immediately so a full budget cannot block cancellation.
 * The caller retains command deduplication and durable execution ownership.
 */
export function makeMobileCommandDispatcher() {
  let activeReads = 0;
  return <E, R, E2, R2>(
    command: GraftMobileCommand,
    run: Effect.Effect<void, E, R>,
    overloaded: Effect.Effect<void, E2, R2>,
  ) =>
    Effect.suspend<void, E | E2, R | R2 | Scope.Scope>(() => {
      if (!isIndependentRead(command)) return run;
      if (activeReads >= MOBILE_CONCURRENT_READS) return overloaded;
      activeReads += 1;
      return run.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            activeReads -= 1;
          }),
        ),
        Effect.forkScoped,
        Effect.asVoid,
      );
    });
}
