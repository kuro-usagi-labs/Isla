/** One IPC request at a time; intermediate frames coalesce into the latest one. */
export function createLatestPublisher<T>(send: (value: T) => Promise<unknown>) {
  let active = false;
  let pending: { value: T } | undefined;
  return async (value: T): Promise<void> => {
    pending = { value };
    if (active) return;
    active = true;
    let failure: { error: unknown } | undefined;
    try {
      while (pending) {
        const next = pending.value;
        pending = undefined;
        try { await send(next); failure = undefined; }
        catch (error) { failure = { error }; }
      }
    } finally { active = false; }
    if (failure) throw failure.error;
  };
}
