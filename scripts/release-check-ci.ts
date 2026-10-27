/* Release preconditions, run by .github/workflows/release.yml before
 * `bun install`, so it imports nothing outside Node built-ins:
 *   bun scripts/release-check-ci.ts */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { checkRelease } from './release-check';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`::error::${name} is not set`);
    process.exit(1);
  }
  return value;
}

function git(...args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return { ok: result.status === 0, stdout: result.stdout.trim() };
}

function readPackageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
  const version =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed ? parsed.version : undefined;
  if (typeof version !== 'string') {
    console.error('::error::package.json has no string version');
    process.exit(1);
  }
  return version;
}

const tag = requireEnv('GITHUB_REF_NAME');
const sha = requireEnv('GITHUB_SHA');
const outputFile = requireEnv('GITHUB_OUTPUT');

if (!git('fetch', '--tags', 'origin', 'main').ok) {
  console.error('::error::could not fetch origin main');
  process.exit(1);
}

const verdict = checkRelease({
  tag,
  packageVersion: readPackageVersion(),
  tagOnMain: git('merge-base', '--is-ancestor', sha, 'origin/main').ok,
});
if (!verdict.ok) {
  console.error(`::error::${verdict.error}`);
  process.exit(1);
}

const previous = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', `${sha}^`);
appendFileSync(outputFile, `previous-tag=${previous.ok ? previous.stdout : ''}\n`);
console.log(`Release ${tag} ok. Notes start after ${previous.ok ? previous.stdout : 'the first commit'}.`);
