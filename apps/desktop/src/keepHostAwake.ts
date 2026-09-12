export type KeepHostAwakeState = {
  keepHostAwake: boolean;
  blocking: boolean;
};

export type KeepHostAwakeStore = {
  load: () => boolean;
  save: (keepHostAwake: boolean) => void;
};

export type PowerSaveBlockerLike = {
  start: (type: "prevent-app-suspension") => number;
  stop: (id: number) => boolean;
};

export function createKeepHostAwakeController(input: {
  readonly store: KeepHostAwakeStore;
  readonly powerSaveBlocker: PowerSaveBlockerLike;
}) {
  let keepHostAwake = input.store.load();
  let blockerId: number | undefined;

  function sync(gatewayEnabled: boolean): KeepHostAwakeState {
    const shouldBlock = keepHostAwake && gatewayEnabled;
    if (shouldBlock && blockerId === undefined) {
      blockerId = input.powerSaveBlocker.start("prevent-app-suspension");
    } else if (!shouldBlock && blockerId !== undefined) {
      input.powerSaveBlocker.stop(blockerId);
      blockerId = undefined;
    }
    return { keepHostAwake, blocking: blockerId !== undefined };
  }

  return {
    getKeepHostAwake(): boolean {
      return keepHostAwake;
    },
    setKeepHostAwake(next: boolean, gatewayEnabled: boolean): KeepHostAwakeState {
      keepHostAwake = next;
      input.store.save(keepHostAwake);
      return sync(gatewayEnabled);
    },
    sync,
  };
}
