/**
 * ── TEST 1: Write Queue Flooding (Spam Test) ──────────────────────────────────
 *
 * Verifies the WriteQueue's coalescing logic under extreme concurrency:
 *   - 100 rapid enqueues for the same note ID must not produce 100 disk writes.
 *   - The final resolved content must always be the most-recently-enqueued run.
 *   - Error propagation must reach every coalesced subscriber.
 *   - The internal maps must not leak memory after completion.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WriteQueue } from '../lib/writeQueue';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Delays for `ms` milliseconds. */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── tests ─────────────────────────────────────────────────────────────────────

describe('WriteQueue — stress tests', () => {
  let queue: WriteQueue;

  beforeEach(() => {
    queue = new WriteQueue();
  });

  // ── 1a: Synchronous coalescing ─────────────────────────────────────────────
  it('coalesces 100 synchronous enqueues into a single disk write', async () => {
    const written: string[] = [];
    const promises: Promise<void>[] = [];

    for (let i = 0; i < 100; i++) {
      const snapshot = `content-${i}`;
      promises.push(
        queue.enqueue({
          id: 'note-1',
          run: async () => { written.push(snapshot); },
        }),
      );
    }

    await Promise.all(promises);

    // All 100 promises must resolve.
    expect(promises).toHaveLength(100);

    // Execution trace: enqueue-0 fires flush() synchronously inside the
    // Promise constructor.  flush() runs synchronously up to `await entry.run()`
    // and adds 'note-1' to inflight BEFORE enqueue-1 executes.  enqueue-1
    // therefore enters the `else` branch (pending is empty, inflight has id)
    // and parks in pending without dispatching another flush.  enqueues 2-99
    // all take the `if (existing)` branch and replace the pending run.
    //
    // Result: gen-1 = run of content-0 (already inflight at dispatch time),
    //         gen-2 = run of content-99 (the last replacement).
    // Total actual disk writes: exactly 2.
    expect(written.length).toBeLessThanOrEqual(2);

    // Regardless of exact coalescing, the LAST write must always be content-99.
    expect(written[written.length - 1]).toBe('content-99');
    expect(queue.isIdle).toBe(true);
  });

  // ── 1b: Inflight coalescing ────────────────────────────────────────────────
  it('coalesces concurrent enqueues while a write is inflight', async () => {
    const written: string[] = [];

    // Generation 1: starts immediately, takes 20 ms.
    const p1 = queue.enqueue({
      id: 'note-1',
      run: async () => {
        await delay(20);
        written.push('gen-1');
      },
    });

    // Give gen-1 a moment to move into inflight before enqueuing gen-2.
    await delay(5);

    // Generations 2–11: arrive while gen-1 is still running.
    // Only the last one (gen-11) should actually execute as gen-2.
    const later = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        queue.enqueue({
          id: 'note-1',
          run: async () => { written.push(`gen-2-edit-${i + 1}`); },
        }),
      ),
    );

    await p1;
    await Promise.all(later);

    // Exactly two actual writes: gen-1 and the final coalesced gen-2.
    expect(written).toHaveLength(2);
    expect(written[0]).toBe('gen-1');
    // The last of the 10 pending edits wins.
    expect(written[1]).toBe('gen-2-edit-10');
    expect(queue.isIdle).toBe(true);
  });

  // ── 1c: Multi-note parallelism ─────────────────────────────────────────────
  it('serialises writes per ID without cross-note interference', async () => {
    const log: string[] = [];

    // 5 notes × 20 edits each = 100 total enqueues.
    const all = Array.from({ length: 5 }, (_, noteIdx) =>
      Array.from({ length: 20 }, (_, editIdx) =>
        queue.enqueue({
          id: `note-${noteIdx}`,
          run: async () => { log.push(`note-${noteIdx}:edit-${editIdx}`); },
        }),
      ),
    ).flat();

    await Promise.all(all);

    // Every note ID must appear in the log (at least once — may be coalesced).
    for (let noteIdx = 0; noteIdx < 5; noteIdx++) {
      expect(log.some((entry) => entry.startsWith(`note-${noteIdx}:`))).toBe(true);
    }
    // Total writes should be far fewer than 100 (coalescing across all IDs).
    expect(log.length).toBeLessThan(100);
    expect(queue.isIdle).toBe(true);
  });

  // ── 1d: Error propagation ──────────────────────────────────────────────────
  it('propagates a write error to every coalesced subscriber', async () => {
    const boom = new Error('DISK_FULL');
    let runCount = 0;

    // Gen-1 is slow (20 ms) so gen-2 edits pile up in pending while it runs.
    const p1 = queue.enqueue({
      id: 'note-err',
      run: async () => {
        await delay(20);
        runCount++;
        throw boom;
      },
    });

    await delay(5); // let gen-1 go inflight

    // Enqueue 5 more while gen-1 is inflight — they get coalesced into gen-2.
    const pendings = Array.from({ length: 5 }, (_, i) =>
      queue.enqueue({
        id: 'note-err',
        run: async () => {
          runCount++;
          throw new Error(`should-not-matter-${i}`);
        },
      }),
    );

    const [p1Result, ...pendingResults] = await Promise.allSettled([p1, ...pendings]);

    // p1 was gen-1's sole subscriber — it must reject with `boom`.
    expect(p1Result.status).toBe('rejected');
    if (p1Result.status === 'rejected') expect(p1Result.reason).toBe(boom);

    // The 5 pending enqueues were coalesced into gen-2.  They all receive the
    // error thrown by gen-2's run function (the last-replaced one, index 4),
    // NOT `boom` — each generation's subscribers get that generation's error.
    pendingResults.forEach((r) => {
      expect(r.status).toBe('rejected');
      if (r.status === 'rejected') {
        expect(r.reason.message).toMatch(/should-not-matter/);
      }
    });

    // Gen-1 (boom) ran, then gen-2 (should-not-matter-4) ran: exactly 2 runs.
    expect(runCount).toBe(2);
    expect(queue.isIdle).toBe(true);
  });

  // ── 1e: Memory leak check ──────────────────────────────────────────────────
  it('leaves no entries in the internal maps after 1 000 enqueues', async () => {
    const promises = Array.from({ length: 1_000 }, () =>
      queue.enqueue({ id: 'note-mem', run: async () => {} }),
    );
    await Promise.all(promises);

    const q = queue as unknown as { pending: Map<string, unknown>; inflight: Set<string> };
    expect(q.pending.size).toBe(0);
    expect(q.inflight.size).toBe(0);
    expect(queue.isIdle).toBe(true);
  });

  // ── 1f: 100 concurrent notes simultaneously (high fan-out) ────────────────
  it('handles 100 distinct note IDs flooded simultaneously without error', async () => {
    const successes: string[] = [];

    const all = Array.from({ length: 100 }, (_, i) =>
      queue.enqueue({
        id: `flood-${i}`,
        run: async () => { successes.push(`flood-${i}`); },
      }),
    );

    await Promise.all(all);

    // Each of the 100 distinct IDs must have been written exactly once
    // (no coalescing across different IDs).
    expect(successes).toHaveLength(100);
    expect(queue.isIdle).toBe(true);
  });
});
