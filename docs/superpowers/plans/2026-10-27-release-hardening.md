# Release and Actions Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The fork publishes its own `v0.2.0` GitHub Release from audited, SHA-pinned, least-privilege workflows, under its own extension ID and YNAB OAuth app.

**Architecture:** CI runs `bun run build` once (build runs `verify`). Release splits into a read-only `build` job that runs all package code and uploads the zip, and a `publish` job that holds write and attestation permissions, runs no package code, and sits behind the `release` environment. Release preconditions (tag shape, tag on `main`, tag equals `package.json` version) live in a pure function in `scripts/release-check.ts` with Vitest tests, called by a thin shell in the workflow.

**Tech Stack:** GitHub Actions, Bun 1.4.2, Vitest, `gh` CLI, actionlint (Docker image).

**Spec:** No separate spec document. The binding decisions are the audit-walk decisions recorded in Global Constraints below, made with the owner on 2026-10-27. The audit itself was a read-only `ci-pipeline` review of `.github/workflows/ci.yml` and `release.yml` at commit `07bc3d6`.

## Global Constraints

- Pin every `uses:` to a 40-hex commit SHA with a `# vX.Y.Z` comment. Verified pins:
  - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`
  - `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`
  - `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`
  - `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2`
  - `actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2`
  - `actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2`
- No workflow runs `lint`, `test`, or `typecheck` as its own step. `bun run build` and `bun run zip` already run `verify`.
- Workflow-level `permissions:` is `contents: read` in CI and `{}` in release. Each job declares its own.
- Every `actions/checkout` sets `persist-credentials: false`.
- Every job sets `runs-on: ubuntu-24.04` and a `timeout-minutes` (CI 15, release build 20, publish 10).
- Release trigger: `tags: ['v[0-9]+.[0-9]+.[0-9]+']`. Release concurrency group `release`, `cancel-in-progress: false`. CI concurrency cancels superseded PR runs only.
- Release build job: `setup-bun` with `no-cache: true`, `setup-node` with `package-manager-cache: false`.
- Publish job: `environment: release`; permissions `contents: write`, `id-token: write`, `attestations: write`; no checkout, no `bun install`.
- Release assets: the `*-chrome.zip` plus `SHA256SUMS`; provenance attested on the zip.
- No `${{ }}` expression inside a `run:` body. Pass context values through `env:`.
- Release notes start after the previous `vX.Y.Z` tag on the commit's history.
- Version: `0.2.0`.
- New extension ID `dfnmlcjhckaldmfigjhjomddnffjiljc`. The private key stays at `~/.config/amazon-exporter-for-ynab/extension-key.pem` and never enters the repo.
- Outward-facing pushes (any tag, and `main` pushes) need the owner's go in the same message. No GitHub settings change through the API: the owner changes settings by hand.
- New tools must be at least 14 days old by release date (owner's supply-chain rule). Record the version chosen in the ledger.

## Review Focus

1. A tag pushed before the commit it names reaches `main`. Expect the build job to fail with a message naming the tag and saying it is not on `main`. Owner pushes with `git push --atomic origin main vX.Y.Z`. Pinned by `checkRelease` test "rejects a tag not on main".
2. Tag pushed without the `package.json` bump. Expect a failure that names both versions. Pinned by "rejects a tag that differs from package.json".
3. `fetch-depth: 0` on a tag push may not create `refs/remotes/origin/main`. Expect the shell to fetch `main` explicitly before the ancestry check. Pinned by Task 2 step: the shell runs `git fetch --no-tags origin main` unconditionally.
4. Old tags carry old workflows: a tag push runs the workflow file at the tagged commit, so pushing upstream `v0.1.1` with Actions on would run upstream's unprotected `release.yml`. Pinned by Task 5 Step 2.
5. First release with no previous release: notes must start after `v0.1.1`, not cover all upstream history. Pinned by Task 4 (push `v0.1.1`) and the `previousTag` output; checked by reading the v0.2.0 release notes in Task 6.
6. A future edit re-adds a tag-pinned action or a separate lint/test step. Pinned by `scripts/workflows.test.ts`.

---

### Task 1: Workflow guard tests and CI rewrite

**Files:**
- Create: `scripts/workflows.test.ts`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`

**Interfaces:**
- Produces: the guard tests that Task 2's `release.yml` must also pass.

- [ ] **Step 1: Write the failing tests** in `scripts/workflows.test.ts`. Read every `.github/workflows/*.yml` as text. Tests:
  - `every action is pinned to a full commit SHA with a version comment`: each line matching `uses:` matches `/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/`.
  - `no workflow runs a verify step on its own`: no line matches `/run: bun run (lint|test|typecheck|verify)\b/`.
  - `every checkout drops its credentials`: each file's count of `actions/checkout@` equals its count of `persist-credentials: false`.
  - `no expression is interpolated inside a run body`: no `run:` block (the `run:` line plus its indented continuation) contains `${{`.
- [ ] **Step 2: Run** `./node_modules/.bin/vitest run scripts/workflows.test.ts`. Expected: FAIL on pinning and credentials (both files use `@v4`/`@v2`), PASS on the other two.
- [ ] **Step 3: Rewrite `ci.yml`** per Global Constraints: workflow `permissions: contents: read`; concurrency `group: ci-${{ github.event.pull_request.number || github.ref }}`, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`; job `ci` on `ubuntu-24.04`, `timeout-minutes: 15`; pinned checkout with `persist-credentials: false`; pinned setup-node `node-version: 22` and `package-manager-cache: false`; pinned setup-bun `bun-version: 1.4.2`; `bun install --frozen-lockfile`; `bun run build`.
- [ ] **Step 4: Write `.github/dependabot.yml`**: `version: 2`, one update for `package-ecosystem: github-actions`, `directory: /`, weekly.
- [ ] **Step 5: Run** the guard tests again. Expected: `ci.yml` assertions pass; `release.yml` still fails pinning and credentials (Task 2 fixes it). Run actionlint: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:<tag> -color`. Pick the newest tag at least 14 days old and ledger it. Expected: no findings for `ci.yml`.
- [ ] **Step 6: No commit yet.** The guard rows for `release.yml` stay red until Task 2, and every commit must be green. Task 2 Step 8 commits both tasks.

### Task 2: Release preflight check and release.yml rewrite

**Files:**
- Create: `scripts/release-check.ts`, `scripts/release-check.test.ts`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Produces:
  ```ts
  export interface ReleaseFacts { tag: string; packageVersion: string; tagOnMain: boolean }
  export type ReleaseVerdict = { ok: true } | { ok: false; error: string };
  export function checkRelease(facts: ReleaseFacts): ReleaseVerdict;
  ```
  Shell entry (`import.meta.main`): reads `GITHUB_REF_NAME`, `GITHUB_SHA`, and `package.json`, runs `git fetch --no-tags origin main`, computes `tagOnMain` with `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`, prints the verdict error and exits 1 on failure. On success it prints `previous-tag=<tag or empty>` to `$GITHUB_OUTPUT`, from `git describe --tags --abbrev=0 --match 'v[0-9]*' "$GITHUB_SHA^"` (empty when none).
- Consumes: Task 1 guard tests.

- [ ] **Step 1: Write the failing tests** in `scripts/release-check.test.ts`:
  - `accepts a version tag on main that matches package.json`: `{ tag: 'v0.2.0', packageVersion: '0.2.0', tagOnMain: true }` gives `{ ok: true }`.
  - `rejects a tag that differs from package.json`: `v0.2.0` with `0.1.1` gives `ok: false`, and the error contains both `v0.2.0` and `0.1.1`.
  - `rejects a tag not on main`: matching versions with `tagOnMain: false` gives an error containing `v0.2.0` and `main`.
  - `rejects a tag that is not vX.Y.Z`: `v0.2.0-rc1` and `vtest` each give `ok: false`.
- [ ] **Step 2: Run** `./node_modules/.bin/vitest run scripts/release-check.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `checkRelease` (pure, no IO) and the shell entry. Use `Bun.spawnSync` for git. The shell imports nothing outside the Bun standard library, so it runs before `bun install`.
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Rewrite `release.yml`** per Global Constraints:
  - `build` job, `contents: read`: pinned checkout with `fetch-depth: 0` and `persist-credentials: false`; pinned setup-bun with `no-cache: true`; step `id: check` runs `bun scripts/release-check.ts`; pinned setup-node; `bun install --frozen-lockfile`; `bun run zip`; `git diff --exit-code`; pinned upload-artifact `name: release-zip`, `path: .output/*-chrome.zip`, `if-no-files-found: error`, `retention-days: 7`. Job output `previous-tag: ${{ steps.check.outputs.previous-tag }}`.
  - `publish` job, `needs: build`, `environment: release`: pinned download-artifact into `dist`; `sha256sum -- *-chrome.zip > SHA256SUMS` in `dist`; pinned attest-build-provenance with `subject-path: dist/*-chrome.zip`; `gh release create "$GITHUB_REF_NAME" dist/*-chrome.zip dist/SHA256SUMS --title "$GITHUB_REF_NAME" --generate-notes --verify-tag`, adding `--notes-start-tag "$PREVIOUS_TAG"` only when `PREVIOUS_TAG` is non-empty (bash array). `env:` holds `GH_TOKEN: ${{ github.token }}`, `GH_REPO: ${{ github.repository }}`, `PREVIOUS_TAG: ${{ needs.build.outputs.previous-tag }}`.
- [ ] **Step 6: Run** `bun run verify` and actionlint over both workflows. Expected: all tests pass including every `workflows.test.ts` row; actionlint reports nothing.
- [ ] **Step 7: Local dry run of the shell** on a throwaway local tag: `git tag v9.9.9 && GITHUB_REF_NAME=v9.9.9 GITHUB_SHA=$(git rev-parse HEAD) GITHUB_OUTPUT=/dev/stdout bun scripts/release-check.ts; git tag -d v9.9.9`. Expected: exit 1, error naming `v9.9.9` and `0.1.1`. Never push this tag.
- [ ] **Step 8: Commit** Task 1 and Task 2 files together: `ci: split release into read-only build and gated publish; preflight tag checks`.

### Task 3: Own extension ID and YNAB OAuth client

**Files:**
- Modify: `wxt.config.ts` (key already swapped, uncommitted), `README.md` (redirect URI already swapped, uncommitted), `lib/core/oauth.ts:6-7`

**Interfaces:**
- Consumes: the client ID the owner registers for redirect URI `https://dfnmlcjhckaldmfigjhjomddnffjiljc.chromiumapp.org/`.

- [ ] **Step 1: Wait for the client ID.** If the owner has not pasted it, stop here and ask. Tasks 4 and 5 do not depend on this task; Task 6 does.
- [ ] **Step 2: Set** `YNAB_OAUTH_CLIENT_ID` to the new value.
- [ ] **Step 3: Run** `bun run build`, then compute the ID from `.output/chrome-mv3/manifest.json` `key` (sha256 of the base64-decoded key, first 32 hex chars mapped 0-f to a-p). Expected: `dfnmlcjhckaldmfigjhjomddnffjiljc`.
- [ ] **Step 4: Owner check, by hand:** load `.output/chrome-mv3` unpacked, click Connect YNAB, finish sign-in. Expected: budgets load. Ask the owner to report the result; do not claim it.
- [ ] **Step 5: Commit** `wxt.config.ts README.md lib/core/oauth.ts` with `feat: fork gets its own extension ID and YNAB OAuth app`.

### Task 4: Version 0.2.0 and README install section

**Files:**
- Modify: `package.json` (`"version"`), `README.md` (Install section)

- [ ] **Step 1: Run** `GITHUB_REF_NAME=v0.2.0 ... bun scripts/release-check.ts` as in Task 2 Step 7 with a local tag `v0.2.0`, then delete the tag. Expected: FAIL naming `0.1.1`.
- [ ] **Step 2: Set** `"version": "0.2.0"`.
- [ ] **Step 3: Rerun** Step 1. Expected: the version error is gone. The ancestry check fails because the commit is not yet on `origin/main`; that is correct.
- [ ] **Step 4: README Install:** replace the "no release builds" paragraph with: download the latest `-chrome.zip` from `https://github.com/austintheriot/amazon-exporter-for-ynab/releases`, check it with `gh attestation verify <zip> --repo austintheriot/amazon-exporter-for-ynab` or against `SHA256SUMS`, then load unpacked. Keep build-from-source below it. In the "Releases" paragraph, say a `vX.Y.Z` tag on a `main` commit whose `package.json` version matches builds the zip, and an owner approval in the `release` environment publishes it.
- [ ] **Step 5: Commit** `package.json README.md` with `release: 0.2.0`.

### Task 5: Push `main` and the upstream `v0.1.1` tag

- [ ] **Step 1: Ask the owner** for the go to push `main` and tag `v0.1.1` (it points at upstream commit `42f81b7`, which is on fork `main`). Do nothing until the go arrives in a message.
- [ ] **Step 2: Confirm Actions is still disabled** on the fork (`gh run list -R austintheriot/amazon-exporter-for-ynab` shows no runs, and the owner has not clicked enable). A tag push runs the workflow file from the tagged commit. At `42f81b7` that is upstream's old `release.yml`: trigger `v*`, `contents: write`, no environment. With Actions on, pushing `v0.1.1` would publish an upstream release on the fork with no approval. If Actions is already on, stop and ask the owner.
- [ ] **Step 3: Run** `git fetch https://github.com/jparavisini/amazon-exporter-for-ynab tag v0.1.1 --no-tags`, check `git rev-parse v0.1.1^{commit}` is `42f81b7521c8dff901e54c4a65526a32ddc6df0c`, then `git push origin main v0.1.1`. Expected: both refs accepted, and `gh run list` still empty.
- [ ] **Step 4: Owner applies settings** from the settings list in this conversation: SHA pinning, tag ruleset, `main` ruleset, `release` environment, enable Actions, Dependabot.
- [ ] **Step 5: Check CI.** After the owner enables Actions, CI does not run until the next push or PR. Ask the owner whether to trigger it with an empty-change push or wait for the next real commit, then use `/monitor-ci`. Expected: `ci` green.

### Task 6: First release

- [ ] **Step 1: Ask the owner** for the go to push `v0.2.0`.
- [ ] **Step 2: Run** `git tag v0.2.0 && git push origin v0.2.0`. Use `/monitor-ci` on the Release run. Expected: `build` green, `publish` waiting for approval.
- [ ] **Step 3: Owner approves** in the Actions UI.
- [ ] **Step 4: Check** `gh release view v0.2.0 -R austintheriot/amazon-exporter-for-ynab`. Expected: assets `amazon-exporter-for-ynab-0.2.0-chrome.zip` and `SHA256SUMS`; notes list only fork commits after `v0.1.1`. Download the zip and run `gh attestation verify` on it. Expected: verified.
