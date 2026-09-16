import { Deferred, Effect, Fiber, Stream } from "effect";
import type { GraftMobileCommand } from "@graft/mobile-contract";
import { describe, expect, it } from "vitest";

import { makeMobileCommandDispatcher, MOBILE_CONCURRENT_READS } from "./commandDispatch";

describe("mobile command dispatch", () => {
  it("loads slash commands and cancels a turn while model discovery is stalled", async () => {
    const completed: string[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatch = makeMobileCommandDispatcher();
        const models = yield* Deferred.make<void>();
        const slash = yield* Deferred.make<void>();
        const overloaded = Effect.sync(() => {
          throw new Error("Unexpected overload");
        });
        yield* dispatch({ type: "models.list" }, Deferred.await(models), overloaded);
        yield* dispatch(
          { type: "composer.commands", threadId: "t1" },
          Effect.sync(() => {
            completed.push("commands");
          }).pipe(Effect.andThen(Deferred.succeed(slash, undefined)), Effect.asVoid),
          overloaded,
        );
        yield* Deferred.await(slash);
        yield* dispatch(
          { type: "turn.cancel", runId: "r1" },
          Effect.sync(() => {
            completed.push("cancel");
          }),
          overloaded,
        );
        expect(completed).toEqual(["commands", "cancel"]);
        expect(yield* Deferred.isDone(models)).toBe(false);
        yield* Deferred.succeed(models, undefined);
      }).pipe(Effect.scoped),
    );
  });

  it("retains receive order for mutations", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatch = makeMobileCommandDispatcher();
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const completed: string[] = [];
        const commands: GraftMobileCommand[] = [
          { type: "thread.set_model", threadId: "t1", modelId: "model" },
          { type: "turn.start", threadId: "t1", text: "hello" },
        ];
        const loop = yield* Stream.fromIterable(commands).pipe(
          Stream.runForEach((command) =>
            dispatch(
              command,
              Effect.gen(function* () {
                if (command.type === "thread.set_model") {
                  yield* Deferred.succeed(started, undefined);
                  yield* Deferred.await(release);
                }
                completed.push(command.type);
              }),
              Effect.void,
            ),
          ),
          Effect.forkScoped,
        );
        yield* Deferred.await(started);
        expect(completed).toEqual([]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(loop);
        expect(completed).toEqual(["thread.set_model", "turn.start"]);
      }).pipe(Effect.scoped),
    );
  });

  it("bounds reads without blocking cancellation and releases slots after failure", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const dispatch = makeMobileCommandDispatcher();
        const release = yield* Deferred.make<void>();
        const finished = yield* Deferred.make<void>();
        let rejected = 0;
        let cancelled = false;
        const overload = Effect.sync(() => {
          rejected += 1;
        });
        for (let i = 0; i < MOBILE_CONCURRENT_READS; i += 1) {
          yield* dispatch(
            { type: "models.list" },
            Deferred.await(release).pipe(
              Effect.andThen(Effect.fail("discovery failed")),
              Effect.catch(() => Effect.void),
            ),
            overload,
          );
        }
        yield* dispatch({ type: "composer.commands", threadId: "t1" }, Effect.void, overload);
        yield* dispatch(
          { type: "turn.cancel", runId: "r1" },
          Effect.sync(() => {
            cancelled = true;
          }),
          overload,
        );
        expect(rejected).toBe(1);
        expect(cancelled).toBe(true);
        yield* Deferred.succeed(release, undefined);
        // Let the admitted reads finish and run their slot finalizers.
        yield* Effect.yieldNow;
        yield* dispatch(
          { type: "composer.commands", threadId: "t1" },
          Deferred.succeed(finished, undefined).pipe(Effect.asVoid),
          overload,
        );
        yield* Deferred.await(finished);
        expect(rejected).toBe(1);
      }).pipe(Effect.scoped),
    );
  });
});
