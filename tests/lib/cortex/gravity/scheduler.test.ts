import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GravityScheduler, GRAVITY_INTERVAL_MS } from '@/lib/cortex/gravity/scheduler';

describe('GravityScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and runs the first cycle', async () => {
    const runCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = new GravityScheduler({ intervalMs: 1000, runCycle });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(runCycle).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('runs on interval', async () => {
    const runCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = new GravityScheduler({ intervalMs: 1000, runCycle });

    scheduler.start();
    // advance past first cycle (immediate) + one full interval
    await vi.advanceTimersByTimeAsync(1010);

    expect(runCycle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('stops cleanly', async () => {
    const runCycle = vi.fn().mockResolvedValue(undefined);
    const scheduler = new GravityScheduler({ intervalMs: 1000, runCycle });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);
    scheduler.stop();

    // advance another full interval — no more calls expected
    await vi.advanceTimersByTimeAsync(2000);

    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(scheduler.isRunning()).toBe(false);
  });

  it('does not run concurrent cycles', async () => {
    // runCycle never resolves during this test — simulates a slow operation
    let resolveFirst: (() => void) | undefined;
    const runCycle = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveFirst = resolve; }),
    );
    const scheduler = new GravityScheduler({ intervalMs: 1000, runCycle });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);   // first cycle starts (stuck)

    // advance past interval — should NOT start a second cycle
    await vi.advanceTimersByTimeAsync(2000);

    expect(runCycle).toHaveBeenCalledTimes(1);

    // cleanup
    resolveFirst?.();
    scheduler.stop();
  });

  it('handles cycle errors without crashing', async () => {
    const runCycle = vi.fn().mockRejectedValue(new Error('boom'));
    const scheduler = new GravityScheduler({ intervalMs: 1000, runCycle });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);

    // scheduler must still be running after an error
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
  });
});

describe('GRAVITY_INTERVAL_MS', () => {
  it('is 6 hours in milliseconds', () => {
    expect(GRAVITY_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});
