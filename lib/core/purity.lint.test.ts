import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const probePath = 'lib/core/__lint_probe__.ts';
const purityMessage = 'lib/core is pure: take the value as a parameter; the shell supplies it.';

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function lintProbe(source: string) {
  const [result] = await eslint.lintText(source, { filePath: probePath });
  if (!result) throw new Error(`ESLint returned no result for probe: ${source}`);
  return result.messages;
}

const bannedProbes = [
  { source: "export const x = fetch('a');", ruleId: 'no-restricted-globals' },
  { source: 'export const x = browser.runtime.id;', ruleId: 'no-restricted-globals' },
  { source: 'export const x = Date.now();', ruleId: 'no-restricted-syntax' },
  { source: 'export const x = new Date();', ruleId: 'no-restricted-syntax' },
  { source: 'export const x = Math.random();', ruleId: 'no-restricted-syntax' },
  { source: 'export const x = performance.now();', ruleId: 'no-restricted-syntax' },
  { source: 'export const x = crypto.randomUUID();', ruleId: 'no-restricted-syntax' },
  { source: 'setTimeout(() => 0, 1);', ruleId: 'no-restricted-globals' },
  { source: 'console.log(1);', ruleId: 'no-restricted-globals' },
  { source: "import { getState } from '@/lib/shell/storage';", ruleId: 'no-restricted-imports' },
  { source: "import { getState } from '../shell/storage';", ruleId: 'no-restricted-imports' },
  { source: "import { defineConfig } from 'wxt';", ruleId: 'no-restricted-imports' },
  { source: "import { readFileSync } from 'node:fs';", ruleId: 'no-restricted-imports' },
];

describe('lib/core purity lint', () => {
  it.each(bannedProbes.map(({ source, ruleId }) => [source, ruleId] as const))(
    '`%s` reports %s',
    async (source, ruleId) => {
      const messages = await lintProbe(source);

      const hits = messages.filter((message) => message.ruleId === ruleId);
      expect(hits, `probe \`${source}\` messages: ${JSON.stringify(messages)}`).not.toHaveLength(0);
      for (const hit of hits) {
        expect(hit.message, `probe \`${source}\``).toContain(purityMessage);
      }
    },
  );

  it('allows `new Date(string)` for date parsing', async () => {
    const source = "export const d = new Date('2026-01-01');";

    const messages = await lintProbe(source);

    expect(messages, `probe \`${source}\``).toEqual([]);
  });
});
