import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const purityMessage = 'lib/core is pure: take the value as a parameter; the shell supplies it.';

const bannedGlobals = [
  'fetch',
  'browser',
  'chrome',
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'XMLHttpRequest',
  'WebSocket',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'console',
];

const bannedCalls = [
  ['Date', 'now'],
  ['Math', 'random'],
  ['performance', 'now'],
  ['crypto', 'getRandomValues'],
  ['crypto', 'randomUUID'],
] as const;

export default defineConfig(
  { ignores: ['.output/', '.wxt/', 'node_modules/', '.superpowers/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['lib/core/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...bannedGlobals.map((name) => ({ name, message: purityMessage })),
      ],
      'no-restricted-syntax': [
        'error',
        ...bannedCalls.map(([object, method]) => ({
          selector: `CallExpression[callee.object.name='${object}'][callee.property.name='${method}']`,
          message: `${object}.${method}() is banned. ${purityMessage}`,
        })),
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: `new Date() with no argument is banned. ${purityMessage}`,
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: ['wxt', 'fs', 'path'].map((name) => ({ name, message: purityMessage })),
          patterns: [
            { regex: '(^|/)lib/shell(/|$)', message: purityMessage },
            { regex: '^\\.\\./shell(/|$)', message: purityMessage },
            { regex: '^wxt/', message: purityMessage },
            { regex: '^node:', message: purityMessage },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    ...vitest.configs.recommended,
  },
);
