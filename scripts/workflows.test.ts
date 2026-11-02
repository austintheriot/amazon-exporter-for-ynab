import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_DIR = join(import.meta.dirname, '..', '.github', 'workflows');

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, text: readFileSync(join(WORKFLOW_DIR, name), 'utf8') }));

function linesMatching(text: string, pattern: RegExp): string[] {
  return text.split('\n').filter((line) => pattern.test(line));
}

function runBodies(text: string): string[] {
  const lines = text.split('\n');
  return lines.flatMap((line, index) => {
    const runStart = /^(\s*(?:- )?)run:/.exec(line);
    if (!runStart) return [];
    const keyColumn = runStart[1]?.length ?? 0;
    const rest = lines.slice(index + 1);
    const endOffset = rest.findIndex(
      (next) => next.trim() !== '' && next.length - next.trimStart().length <= keyColumn,
    );
    const continuation = endOffset === -1 ? rest : rest.slice(0, endOffset);
    return [[line, ...continuation].join('\n')];
  });
}

describe('workflows', () => {
  it('finds the workflow files', () => {
    expect(workflows.map((workflow) => workflow.name).sort()).toEqual(['ci.yml', 'release.yml']);
  });

  it.each(workflows)('$name pins every action to a full commit SHA with a version comment', ({ text }) => {
    const unpinned = linesMatching(text, /uses:/).filter(
      (line) => !/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(line),
    );
    expect(unpinned).toEqual([]);
  });

  it.each(workflows)('$name runs no verify step on its own', ({ text }) => {
    const verifySteps = runBodies(text).filter((body) =>
      /\bbun run (lint|test|typecheck|verify)\b|\b(vitest|eslint|tsc)\b/.test(body),
    );
    expect(verifySteps).toEqual([]);
  });

  it.each(workflows)('$name drops credentials after every checkout', ({ text }) => {
    const checkouts = linesMatching(text, /actions\/checkout@/).length;
    const dropped = linesMatching(text, /persist-credentials: false/).length;
    expect(dropped).toBe(checkouts);
  });

  it.each(workflows)('$name uploads no artifact from a hidden path', ({ text }) => {
    const lines = text.split('\n');
    const hiddenUploads = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.includes('uses: actions/upload-artifact@'))
      .flatMap(({ index }) => lines.slice(index + 1, index + 8))
      .filter((line) => /^\s*path:\s*\.[^/]/.test(line));
    expect(hiddenUploads).toEqual([]);
  });

  it.each(workflows)('$name interpolates no expression inside a run body', ({ text }) => {
    expect(runBodies(text).filter((body) => body.includes('${{'))).toEqual([]);
  });
});
