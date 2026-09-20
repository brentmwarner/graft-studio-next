let pendingChange: Promise<unknown> = Promise.resolve();

/** Keep runtime changes and their persisted intent ordered, even if a request disconnects. */
export function serializeMobileConnectionChange<T>(change: () => Promise<T>): Promise<T> {
  const result = pendingChange.then(change);
  pendingChange = result.catch(() => undefined);
  return result;
}
