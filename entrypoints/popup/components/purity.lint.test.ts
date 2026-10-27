import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const probePath = 'entrypoints/popup/components/__lint_probe__.ts';
const fix = 'Components emit msg events; IO lives in lib/shell/popup-services.ts.';

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function lintProbe(source: string) {
  const [result] = await eslint.lintText(source, { filePath: probePath });
  if (!result) throw new Error(`ESLint returned no result for probe: ${source}`);
  return result.messages;
}

describe('popup component purity lint', () => {
  it.each([
    'export const x = browser.runtime.id;',
    'export const x = chrome.runtime.id;',
    "export const x = fetch('a');",
    "export const x = localStorage.getItem('a');",
    'setTimeout(() => 0, 1);',
    'setInterval(() => 0, 1);',
  ])('`%s` is banned', async (source) => {
    const messages = await lintProbe(source);
    const hits = messages.filter((message) => message.ruleId === 'no-restricted-globals');
    expect(hits).not.toHaveLength(0);
    for (const hit of hits) expect(hit.message).toContain(fix);
  });

  it('allows a component that only renders', async () => {
    const messages = await lintProbe("export const tag = 'amex-app';");
    expect(messages.filter((message) => message.ruleId === 'no-restricted-globals')).toEqual([]);
  });
});
