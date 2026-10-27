import { describe, expect, it } from 'vitest';
import { checkRelease, type ReleaseFacts } from './release-check';

function facts(overrides: Partial<ReleaseFacts> = {}): ReleaseFacts {
  return { tag: 'v0.2.0', packageVersion: '0.2.0', tagOnMain: true, ...overrides };
}

describe('checkRelease', () => {
  it('accepts a version tag on main that matches package.json', () => {
    expect(checkRelease(facts())).toEqual({ ok: true });
  });

  it('rejects a tag that differs from package.json', () => {
    const verdict = checkRelease(facts({ packageVersion: '0.1.1' }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error).toContain('v0.2.0');
    expect(verdict.error).toContain('0.1.1');
  });

  it('rejects a tag not on main', () => {
    const verdict = checkRelease(facts({ tagOnMain: false }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error).toContain('v0.2.0');
    expect(verdict.error).toContain('main');
  });

  it.each(['v0.2.0-rc1', 'vtest', '0.2.0', 'v0.2'])('rejects a tag that is not vX.Y.Z: %s', (tag) => {
    expect(checkRelease(facts({ tag })).ok).toBe(false);
  });
});
