import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const probePath = 'lib/core/__lint_probe__.ts';

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function lintProbe(source: string) {
  const [result] = await eslint.lintText(source, { filePath: probePath });
  if (!result) throw new Error(`ESLint returned no result for probe: ${source}`);
  return result.messages;
}

const clock = 'Pass the clock in from the shell.';
const random = 'Pass the random source in from the shell.';
const hostGlobal = 'Read the value in lib/shell and pass it in as a parameter.';
const files = 'Do file and path work in lib/shell and pass the result in.';
const shellImport = 'Have lib/shell call lib/core and pass the values in.';

const bannedProbes = [
  { source: "export const x = fetch('a');", ruleId: 'no-restricted-globals', fix: 'Do network IO in lib/shell' },
  { source: 'export const x = browser.runtime.id;', ruleId: 'no-restricted-globals', fix: 'Call the extension API in lib/shell' },
  { source: 'export const x = Date.now();', ruleId: 'no-restricted-syntax', fix: clock },
  { source: 'export const x = new Date();', ruleId: 'no-restricted-syntax', fix: clock },
  { source: 'export const x = Date();', ruleId: 'no-restricted-syntax', fix: clock },
  { source: 'export const x = Math.random();', ruleId: 'no-restricted-syntax', fix: random },
  { source: 'export const x = performance.now();', ruleId: 'no-restricted-syntax', fix: clock },
  { source: 'export const x = crypto.randomUUID();', ruleId: 'no-restricted-syntax', fix: random },
  { source: 'setTimeout(() => 0, 1);', ruleId: 'no-restricted-globals', fix: 'Schedule work in lib/shell' },
  { source: 'console.log(1);', ruleId: 'no-restricted-globals', fix: 'log it in lib/shell' },
  { source: 'export const x = process.env.HOME;', ruleId: 'no-restricted-globals', fix: 'Read env and argv in the shell' },
  { source: 'export const x = navigator.language;', ruleId: 'no-restricted-globals', fix: hostGlobal },
  { source: 'export const x = location.href;', ruleId: 'no-restricted-globals', fix: hostGlobal },
  { source: 'export const x = self.origin;', ruleId: 'no-restricted-globals', fix: hostGlobal },
  { source: 'export const x = globalThis.fetch;', ruleId: 'no-restricted-globals', fix: hostGlobal },
  { source: "export const x = import('../shell/storage');", ruleId: 'no-restricted-syntax', fix: 'IO modules belong in lib/shell' },
  { source: "import { getState } from '@/lib/shell/storage';", ruleId: 'no-restricted-imports', fix: shellImport },
  { source: "import { getState } from '../shell/storage';", ruleId: 'no-restricted-imports', fix: shellImport },
  { source: "import { defineConfig } from 'wxt';", ruleId: 'no-restricted-imports', fix: 'Call wxt in lib/shell' },
  { source: "import { readFileSync } from 'node:fs';", ruleId: 'no-restricted-imports', fix: 'Use Node APIs in lib/shell' },
  { source: "import { readFile } from 'fs/promises';", ruleId: 'no-restricted-imports', fix: files },
  { source: "import { join } from 'path/posix';", ruleId: 'no-restricted-imports', fix: files },
];

describe('lib/core purity lint', () => {
  it.each(bannedProbes.map(({ source, ruleId, fix }) => [source, ruleId, fix] as const))(
    '`%s` reports %s',
    async (source, ruleId, fix) => {
      const messages = await lintProbe(source);

      const hits = messages.filter((message) => message.ruleId === ruleId);
      expect(hits, `probe \`${source}\` messages: ${JSON.stringify(messages)}`).not.toHaveLength(0);
      for (const hit of hits) {
        expect(hit.message, `probe \`${source}\``).toContain('is banned in lib/core');
        expect(hit.message, `probe \`${source}\``).toContain(fix);
      }
    },
  );

  it('allows `new Date(string)` for date parsing', async () => {
    const source = "export const d = new Date('2026-01-01');";

    const messages = await lintProbe(source);

    expect(messages, `probe \`${source}\``).toEqual([]);
  });
});
