/**
 * writeQueue.ts
 *
 * Serialises FS write operations per note ID, coalescing rapid successive
 * saves into a single disk write.  The latest content always wins — if a
 * write is already inflight for a given ID, the next enqueue call replaces
 * the pending run while adding the caller to the subscriber list.  All
 * subscribers are resolved (or rejected) together once the write completes.
 *
 * This eliminates race conditions from concurrent `flushNote` calls and
 * ensures the app never writes a stale snapshot over a more recent one.
 */

interface SubEntry {
  res: () => void;
  rej: (err: unknown) => void;
}

interface PendingEntry {
  run: () => Promise<void>;
  subs: SubEntry[];
}

export class WriteQueue {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly inflight = new Set<string>();

  /**
   * Enqueue a write task for `task.id`.
   *
   * - If no task is currently inflight for this ID, it is dispatched
   *   immediately.
   * - If a task is inflight, the new run replaces any pending successor
   *   (so the freshest content always lands on disk) and the returned
   *   Promise resolves when that successor completes.
   */
  enqueue(task: { id: string; run: () => Promise<void> }): Promise<void> {
    return new Promise<void>((res, rej) => {
      const existing = this.pending.get(task.id);
      if (existing) {
        // Replace run with latest, but accumulate all waiting subscribers.
        this.pending.set(task.id, {
          run: task.run,
          subs: [...existing.subs, { res, rej }],
        });
      } else {
        this.pending.set(task.id, { run: task.run, subs: [{ res, rej }] });
        if (!this.inflight.has(task.id)) void this.flush(task.id);
      }
    });
  }

  private async flush(id: string): Promise<void> {
    const entry = this.pending.get(id);
    if (!entry) return;

    this.pending.delete(id);
    this.inflight.add(id);

    try {
      await entry.run();
      entry.subs.forEach(({ res }) => res());
    } catch (err) {
      entry.subs.forEach(({ rej }) => rej(err));
    } finally {
      this.inflight.delete(id);
      // If another write arrived while this one was inflight, dispatch it now.
      if (this.pending.has(id)) void this.flush(id);
    }
  }

  /** `true` when no writes are pending or inflight. */
  get isIdle(): boolean {
    return this.pending.size === 0 && this.inflight.size === 0;
  }
}

/** Module-level singleton shared by all note write operations. */
export const noteWriteQueue = new WriteQueue();
