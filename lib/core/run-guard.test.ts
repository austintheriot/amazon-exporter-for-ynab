import { describe, expect, it } from 'vitest';
import { createRunGuard } from './run-guard';

describe('createRunGuard', () => {
  it('keeps a started run current while nothing cancels it', () => {
    const guard = createRunGuard();
    const run = guard.start();
    expect(guard.isCurrent(run)).toBe(true);
  });

  it('makes every earlier run stale after cancelAll', () => {
    const guard = createRunGuard();
    const first = guard.start();
    const second = guard.start();
    guard.cancelAll();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(false);
  });

  it('keeps a run started after cancelAll current', () => {
    const guard = createRunGuard();
    guard.cancelAll();
    const run = guard.start();
    expect(guard.isCurrent(run)).toBe(true);
  });

  it('does not share state between guards', () => {
    const cancelled = createRunGuard();
    const other = createRunGuard();
    const run = other.start();
    cancelled.cancelAll();
    expect(other.isCurrent(run)).toBe(true);
  });
});
