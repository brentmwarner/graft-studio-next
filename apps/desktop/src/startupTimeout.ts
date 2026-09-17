// FILE: startupTimeout.ts
// Purpose: Bounds optional desktop startup work so core app boot cannot stall indefinitely.
// Layer: Desktop startup utility

export async function withStartupTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid startup timeout for ${description}: ${timeoutMs}.`);
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`${description} timed out after ${timeoutMs}ms.`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([task(controller.signal), deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
