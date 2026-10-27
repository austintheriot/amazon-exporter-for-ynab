import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const replacement = {
  clock: 'Pass the clock in from the shell.',
  random: 'Pass the random source in from the shell.',
  network: 'Do network IO in lib/shell and pass the result in.',
  extensionApi: 'Call the extension API in lib/shell and pass the result in.',
  storage: 'Read storage in lib/shell and pass the stored value in.',
  scheduling: 'Schedule work in lib/shell and return the plan as data.',
  logging: 'Return the message as data and log it in lib/shell.',
  hostGlobal: 'Read the value in lib/shell and pass it in as a parameter.',
  process: 'Read env and argv in the shell and pass the values in.',
  files: 'Do file and path work in lib/shell and pass the result in.',
  shellImport: 'Have lib/shell call lib/core and pass the values in.',
  wxt: 'Call wxt in lib/shell and pass the result in.',
  node: 'Use Node APIs in lib/shell and pass the result in.',
  dynamicImport: 'Use a static import of a lib/core module. IO modules belong in lib/shell.',
} as const;

const banned = (what: string, fix: string): string => `${what} is banned in lib/core (pure). ${fix}`;

const bannedGlobals: readonly (readonly [string, string])[] = [
  ['fetch', replacement.network],
  ['XMLHttpRequest', replacement.network],
  ['WebSocket', replacement.network],
  ['browser', replacement.extensionApi],
  ['chrome', replacement.extensionApi],
  ['localStorage', replacement.storage],
  ['sessionStorage', replacement.storage],
  ['indexedDB', replacement.storage],
  ['setTimeout', replacement.scheduling],
  ['setInterval', replacement.scheduling],
  ['queueMicrotask', replacement.scheduling],
  ['console', replacement.logging],
  ['window', replacement.hostGlobal],
  ['document', replacement.hostGlobal],
  ['navigator', replacement.hostGlobal],
  ['location', replacement.hostGlobal],
  ['self', replacement.hostGlobal],
  ['globalThis', replacement.hostGlobal],
  ['process', replacement.process],
];

const bannedCalls = [
  ['Date', 'now', replacement.clock],
  ['performance', 'now', replacement.clock],
  ['Math', 'random', replacement.random],
  ['crypto', 'getRandomValues', replacement.random],
  ['crypto', 'randomUUID', replacement.random],
] as const;

const bannedModules = [
  ['wxt', replacement.wxt],
  ['fs', replacement.files],
  ['fs/promises', replacement.files],
  ['path', replacement.files],
  ['path/posix', replacement.files],
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
        ...bannedGlobals.map(([name, fix]) => ({ name, message: banned(name, fix) })),
      ],
      'no-restricted-syntax': [
        'error',
        ...bannedCalls.map(([object, method, fix]) => ({
          selector: `CallExpression[callee.object.name='${object}'][callee.property.name='${method}']`,
          message: banned(`${object}.${method}()`, fix),
        })),
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: banned('new Date() with no argument', replacement.clock),
        },
        {
          selector: "CallExpression[callee.name='Date']",
          message: banned('Date() without new', replacement.clock),
        },
        {
          selector: 'ImportExpression',
          message: banned('Dynamic import()', replacement.dynamicImport),
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: bannedModules.map(([name, fix]) => ({ name, message: banned(`'${name}'`, fix) })),
          patterns: [
            { regex: '(^|/)lib/shell(/|$)', message: banned('Importing lib/shell', replacement.shellImport) },
            { regex: '^\\.\\./shell(/|$)', message: banned('Importing lib/shell', replacement.shellImport) },
            { regex: '^wxt/', message: banned('Importing wxt', replacement.wxt) },
            { regex: '^node:', message: banned('Importing node: modules', replacement.node) },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-standalone-expect': [
        'error',
        { additionalTestBlockFunctions: ['it.prop'] },
      ],
    },
  },
);
