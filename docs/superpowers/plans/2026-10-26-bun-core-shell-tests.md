# Bun, Functional Core, and Vitest Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the extension to Bun and Vitest, split it into a pure `lib/core/` and an IO-only `lib/shell/`, add strict lint and Zod boundary parsing, and cover the core with tests, without changing behavior on valid input.

**Architecture:** The core takes fetched pages, YNAB data, settings, and the current date as plain data and returns proposals, decisions, and messages as data. The shell (`lib/shell/`, `entrypoints/`) does every fetch, storage access, and clock read. An ESLint block bans IO in `lib/core/`, and a test proves the ban fires. A temporary characterization test pins today's `background.ts` behavior during the extraction and is deleted at the end.

**Tech Stack:** Bun 1.4 (package manager and script runner), WXT 0.21.4 on Vite 8, Vitest 4.1.x with `WxtVitest`, TypeScript 5.9.3, Cheerio, Zod 4, ESLint with `typescript-eslint`, fast-check.

**Spec:** `docs/superpowers/specs/2026-10-26-bun-core-shell-tests-design.md`

## Global Constraints

- No change to proposals, memos, splits, counts, `scanDebug`, `debugCaptures`, status messages, storage write order, or proposal order for valid input.
- Two accepted changes on invalid input only: a malformed YNAB response fails the scan with an error naming the endpoint and the issue path. A corrupt stored field falls back to its default, one field at a time.
- No test makes a network request. No test touches live Amazon or YNAB.
- `lib/core/` uses no `fetch`, `browser`, `chrome`, `Date.now()`, argument-less `new Date()`, `Math.random()`, timers, or `console`, and imports nothing from `lib/shell`, `wxt`, or `node:*`. `new Date(string)` is allowed.
- No `!` non-null assertions in production code. Test files only, directly after a same-statement `expect(x).toBeDefined()`.
- New dependencies: newest release at least 14 days old. Vitest 4.1.x (WXT's own dev dependency is `^4.1.10`), not 5.x.
- Bun runs scripts and installs. WXT, Vitest, and `tsc` run on Node through their shebangs. No `--bun`.
- The lockfile migration keeps every current dependency version. No fresh resolve.
- Real Amazon pages and YNAB data never enter git.
- Commits: one per task minimum, Conventional Commits, staged by named path, ending with the session's `Co-Authored-By` and `Claude-Session` lines.

## Review Focus

1. **Amounts with a thousands separator** (`$1,234.56`) on both Transactions page layouts and on invoices must parse to `1234.56`. Test added to Task 1 (parsers).
2. **A YNAB memo of only whitespace** counts as blank and stays matchable. A `null` `payee_name` never matches. Test added to Task 1 (matcher).
3. **Window edges:** a charge dated exactly `sinceDate` is kept, one dated the day before is dropped, and with a year set a charge on `YYYY-12-31` is kept. Test added to Task 5 (`finalizeCharges`).
4. **State written by version 0.1.1** (before Zod) must parse to an identical value after the upgrade, so the popup shows the last scan. Test added to Task 8 (`parseSyncState`).
5. **A refund whose original purchase is outside the YNAB lookback** gets a memo without the `→ was:` suffix, not an error. Test added to Task 6 (`buildScanResult`).

---

### Task 1: Bun and Vitest, with the smoke cases ported

**Files:**
- Modify: `package.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/parse-captures.ts:1-3` (usage line), `.gitignore` (no change expected, check `bun.lock` is not ignored)
- Create: `vitest.config.ts`, `bun.lock`, `lib/matcher.test.ts`, `lib/amazon.test.ts`, `test/fixtures/amazon.ts` (synthetic HTML strings moved out of `scripts/smoke.ts`)
- Delete: `package-lock.json`, `scripts/smoke.ts`

**Interfaces:**
- Produces: `bun run test` (`vitest run`), `bun run test:watch` (`vitest`), `bun run typecheck`, `bun run build`, `bun run zip`, `bun run zip:store`. Fixture exports in `test/fixtures/amazon.ts`: `transactionsHtml`, `lastPageHtml`, `legacyInvoiceHtml`, `modernInvoiceHtml`, `nextDataHtml` (new, a `__NEXT_DATA__` page with one charge, one refund, one row missing `formattedDate`).

- [ ] **Step 1:** Record current versions: `npm ls cheerio wxt vite typescript --depth=0 > "$SCRATCH/versions-before.txt"` (scratchpad path).
- [ ] **Step 2:** Run `bun install` (migrates `package-lock.json`). Delete `package-lock.json`. Set `"packageManager": "bun@1.4.2"`. Replace `tsx` with nothing (remove the dev dependency). Add `vitest@4.1.x` (newest 4.1 patch at least 14 days old). Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, remove `smoke`. Keep `"postinstall": "wxt prepare"`.
- [ ] **Step 3:** Compare: `bun pm ls | grep -E 'cheerio|wxt|vite|typescript'` against `versions-before.txt`. Expected: identical versions.
- [ ] **Step 4:** Create `vitest.config.ts` with `defineConfig({ plugins: [WxtVitest()] })` from `vitest/config` and `wxt/testing/vitest-plugin`.
- [ ] **Step 5:** Port every `check(...)` in `scripts/smoke.ts` to an `it(...)` with the same name and an `expect` with the same condition. Parser cases go to `lib/amazon.test.ts`, matcher, memo, refund, and split cases to `lib/matcher.test.ts`. Move the HTML strings to `test/fixtures/amazon.ts`.
- [ ] **Step 6:** Add Review Focus tests 1 and 2:

```ts
it('parses thousands separators on both page layouts and invoices', () => {
  // markup row "-$1,234.56", __NEXT_DATA__ row formattedAmount "-$1,234.56",
  // invoice "Grand Total: $1,234.56"
  expect(markupCharge.amount).toBe(1234.56);
  expect(jsonCharge.amount).toBe(1234.56);
  expect(order?.total).toBe(1234.56);
});
it('treats a whitespace-only memo as blank', () => {
  expect(matchCharges([charge], [{ ...txn, memo: '   ' }])).toHaveLength(1);
});
it('never matches a null payee', () => {
  expect(matchCharges([charge], [{ ...txn, payee_name: null }])).toHaveLength(0);
});
```

Also add `__NEXT_DATA__` cases: one charge, one credit (`amountDetailsStatusType: 'Refund'`), the row without a date skipped, and a page with no `__NEXT_DATA__` script giving empty lists.
- [ ] **Step 7:** Run `bun run test`. Expected: all pass. If a new Review Focus test fails against today's code, mark it `it.fails`, add a comment naming the defect, and note it for the final report. Do not fix the code.
- [ ] **Step 8:** Update `scripts/parse-captures.ts` usage text to `bun scripts/parse-captures.ts <debug.json>`.
- [ ] **Step 9:** CI: in both workflows, keep `actions/setup-node@v4` with `node-version: 22` (drop `cache: npm`), add `oven-sh/setup-bun@v2` with `bun-version: 1.4.2`, replace `npm ci` with `bun install --frozen-lockfile`, `npm run smoke` with `bun run test`, other `npm run X` with `bun run X`.
- [ ] **Step 10:** Run `bun install --frozen-lockfile && bun run test && bun run typecheck && bun run build`. Expected: all succeed.
- [ ] **Step 11:** Commit `build: switch to Bun and Vitest, port smoke tests`.

### Task 2: Temporary characterization test of `background.ts`

**Files:**
- Modify: `entrypoints/background.ts` (add `export` to `runScan` and `runApply`, nothing else)
- Create: `entrypoints/background.characterization.test.ts`, `test/fixtures/scan-world.ts`

**Interfaces:**
- Produces: `createScanWorld(options): ScanWorld` in `test/fixtures/scan-world.ts`. It installs `fakeBrowser` (from `wxt/testing/fake-browser`) storage contents (settings, a token `{ accessToken: 'tok', expiresAt: <far future> }` under `oauthToken`) and stubs `fetch` with `vi.stubGlobal`. It routes `GET/POST https://www.amazon.com/cpe/yourpayments/transactions`, `GET https://www.amazon.com/gp/css/summary/print.html?orderID=<id>`, `GET https://api.ynab.com/v1/budgets/<id>/transactions?since_date=<date>`, and `PUT .../transactions/<id>`. It records every `storage.local.set` value for `syncState` in order (`stateWrites`), every requested URL (`requests`), and every PUT body (`ynabWrites`). Unknown URLs throw.

- [ ] **Step 1:** Write tests. Use `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(new Date('2026-07-01T15:00:00Z'))`. Assert with `toEqual` on whole values (snapshot files are not allowed, so expected values are written out in the test). Scenarios:
  - `recent window`: settings `year: null` makes the first YNAB request use `since_date=2026-02-01` (90 days before 2026-07-01 is 2026-04-02, then 60 days earlier is 2026-02-01).
  - `year window`: `year: 2025` makes the YNAB request use `since_date=2024-11-02` and drops a 2026 charge.
  - `full scan`: two physical charges (one order with 2 priced items equal to the charge total, one already-split YNAB transaction), one `D01-…` digital charge, one refund whose original purchase has a category, one matched order whose invoice returns the "We're sorry!" page. Assert the final `syncState` (`proposals` in order, `counts` `{ charges: 4, credits: 1, digitalSkipped: 1, invoicesUnparsed: 1 }`, `message: 'Found 4 charges, matched 3 transactions.'`, `scanDebug.candidates`, `debugCaptures` length and order), and the full `stateWrites` sequence of `status`/`message` pairs.
  - `capture cap`: five unparseable invoices give `debugCaptures.length === 3`, invoice captures in request order, and each `html.length <= 500_000`.
  - `empty first page`: a Transactions page with no rows gives one capture with `orderId: '(transactions page)'` and zero proposals.
  - `ynab 401`: the transactions request returns 401. Final state is `{ status: 'error', message: 'YNAB session expired. Reconnect YNAB in the popup.' }` and the `oauthToken` key is removed.
  - `amazon sign-in`: the Transactions page has `<h1>Sign in</h1>`. Final message is `'Not signed in to Amazon. Open amazon.com, sign in, then scan again.'`.
  - `no budget`: settings with `budgetId: ''` give `'Pick a budget first.'` and no fetch.
  - `apply`: after the full scan, `runApply` with two txn IDs where the second PUT returns 500. Assert `ynabWrites` bodies (memo and `subtransactions` for the split one), `appliedTxnIds`, and final message `'Applied 1 memos, 1 failed.'`.
- [ ] **Step 2:** Run `bun run test entrypoints/background.characterization.test.ts`. Expected: PASS against unchanged logic. A failure here means the test is wrong, not the code. Fix the test.
- [ ] **Step 3:** Commit `test: temporary characterization test of background scan and apply`.

### Task 3: Move to `lib/core/` and `lib/shell/`

Pure move. No logic change except two parser helpers that replace inline checks.

**Files:**
- Create: `lib/core/amazon.ts`, `lib/core/ynab.ts`, `lib/core/state.ts`, `lib/core/matcher.ts`, `lib/core/errors.ts`, `lib/shell/amazon.ts`, `lib/shell/ynab.ts`, `lib/shell/storage.ts`, `lib/shell/oauth.ts`
- Move: `lib/matcher.test.ts` to `lib/core/matcher.test.ts`, `lib/amazon.test.ts` to `lib/core/amazon.test.ts`
- Delete: `lib/amazon.ts`, `lib/ynab.ts`, `lib/state.ts`, `lib/matcher.ts`, `lib/oauth.ts`
- Modify: `entrypoints/background.ts`, `entrypoints/popup/main.ts` (imports only), `scripts/parse-captures.ts` (import), `README.md:49,64` (paths)

**Interfaces:**
- Produces, `lib/core/amazon.ts`: types `AmazonCharge`, `AmazonItem`, `AmazonOrder`, `ScanCounts`, `DebugCapture`. Constants `AMAZON_ORIGINS`, `AMAZON_LOGIN_URL`, `TRANSACTIONS_URL`, `ORDER_DETAILS_URL`, `MAX_TRANSACTION_PAGES = 25`, `DEBUG_HTML_MAX = 500_000`. Functions `parseTransactionsPage($: CheerioAPI)`, `buildNextPageBody($: CheerioAPI): string | null`, `parseInvoice(html: string, orderId: string): AmazonOrder | null`, `isSignInPage($: CheerioAPI): boolean`, `isOrderNotFoundPage($: CheerioAPI): boolean`.
- `lib/core/ynab.ts`: `YnabBudget`, `YnabTransaction`, `YnabSplit`, `dollarsToOutflowMilliunits`.
- `lib/core/state.ts`: `Settings`, `SyncStatus`, `SyncState`, `ScanDebug`, `Message`, `DEFAULT_SETTINGS`, `DEFAULT_STATE`.
- `lib/core/errors.ts`: `AmazonSessionError`, `YnabAuthError`.
- `lib/core/matcher.ts`: unchanged exports (`MatchProposal`, `ChargeMatch`, `buildMemo`, `buildRefundMemo`, `buildSplits`, `matchCharges`, `matchRefunds`, `findOriginalTransaction`).
- `lib/shell/amazon.ts`: `fetchAmazonCharges`, `fetchOrderDetails`, `FetchChargesOptions` (same signatures as today). Throws `AmazonSessionError` when `isSignInPage` is true.
- `lib/shell/ynab.ts`: `getBudgets`, `getTransactions`, `updateTransactionMemo` (same signatures).
- `lib/shell/storage.ts`: `getSettings`, `saveSettings`, `getState`, `setState`.
- `lib/shell/oauth.ts`: `YNAB_OAUTH_CLIENT_ID`, `oauthRedirectUri`, `oauthConfigured`, `authorize`, `getAccessToken`, `isConnected`, `disconnect` (same as today, Task 7 moves the pure parts).

- [ ] **Step 1:** Add tests to `lib/core/amazon.test.ts`: `isSignInPage` true for `<h1>Sign in</h1>`, false for the Transactions fixture. `isOrderNotFoundPage` true for `<h2>We're sorry!</h2>`, false for an invoice fixture. Run. Expected: FAIL, functions not exported.
- [ ] **Step 2:** Move code into the files above. `isSignInPage` and `isOrderNotFoundPage` return the existing selector checks. Update all imports.
- [ ] **Step 3:** Run `bun run test && bun run typecheck && bun run build`. Expected: all pass, characterization test unchanged and green.
- [ ] **Step 4:** Commit `refactor: split lib into core and shell`.

### Task 4: Strict TypeScript, strict ESLint, and the core IO ban

**Files:**
- Create: `eslint.config.ts`, `lib/core/purity.lint.test.ts`
- Modify: `package.json` (deps, `"lint": "eslint ."`), `tsconfig.json`, both workflows (add `bun run lint` before tests), every file with a violation

**Interfaces:**
- Produces: `bun run lint`. The core ban rules, each with message `lib/core is pure: take the value as a parameter; the shell supplies it.`

- [ ] **Step 1:** Write `lib/core/purity.lint.test.ts`. It creates `new ESLint({ cwd: repoRoot })` and calls `lintText(source, { filePath: 'lib/core/__lint_probe__.ts' })` for each probe, then asserts the expected `ruleId`:

| Probe source | Expected `ruleId` |
|---|---|
| `export const x = fetch('a');` | `no-restricted-globals` |
| `export const x = browser.runtime.id;` | `no-restricted-globals` |
| `export const x = Date.now();` | `no-restricted-syntax` |
| `export const x = new Date();` | `no-restricted-syntax` |
| `export const x = Math.random();` | `no-restricted-syntax` |
| `export const x = performance.now();` | `no-restricted-syntax` |
| `export const x = crypto.randomUUID();` | `no-restricted-syntax` |
| `setTimeout(() => 0, 1);` | `no-restricted-globals` |
| `console.log(1);` | `no-restricted-globals` |
| `import { getState } from '@/lib/shell/storage';` | `no-restricted-imports` |
| `import { getState } from '../shell/storage';` | `no-restricted-imports` |
| `import { defineConfig } from 'wxt';` | `no-restricted-imports` |
| `import { readFileSync } from 'node:fs';` | `no-restricted-imports` |
| `export const d = new Date('2026-01-01');` | none |

Each failing assertion names the probe. Run. Expected: FAIL (no ESLint config).
- [ ] **Step 2:** Install `eslint`, `@eslint/js`, `typescript-eslint`, and `jiti` (needed for a `.ts` config), each the newest release at least 14 days old. `eslint.config.ts`: ignores `.output`, `.wxt`, `node_modules`. `js.configs.recommended`, `tseslint.configs.strictTypeChecked`, `tseslint.configs.stylisticTypeChecked`, `parserOptions.projectService: true`. A block for `lib/core/**/*.ts` excluding `**/*.test.ts` with the three ban rules per the spec's lists. Add `@vitest/eslint-plugin` only under the spec's TypeScript 5.9 condition.
- [ ] **Step 3:** Run `bun run test lib/core/purity.lint.test.ts`. Expected: PASS.
- [ ] **Step 4:** `tsconfig.json`: remove `"noUncheckedIndexedAccess": false`, add `exactOptionalPropertyTypes`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`, `useUnknownInCatchVariables` (all `true`).
- [ ] **Step 5:** Run `bun run typecheck` and `bun run lint`. Fix every error without changing behavior. Replace each `!` (`priced[0]`, `i.price!`, `eventInput.attr('name')!`, `document.getElementById('app')!`, and any the new index checks expose) with a check that keeps today's result: an early `return null` where the surrounding function already returns `null` for missing data, and a thrown `Error` naming the missing element for `#app`. Use a line-level `eslint-disable-next-line <rule> -- <reason>` only when every fix would change behavior, and list each one in the commit body.
- [ ] **Step 6:** Run `bun run lint && bun run typecheck && bun run test && bun run build`. Expected: zero errors, all tests green including the characterization test.
- [ ] **Step 7:** Commit `build: strict TypeScript and ESLint with a pure-core IO ban`.

### Task 5: Paging decision in the core

**Files:**
- Create: `lib/core/paging.ts`, `lib/core/paging.test.ts`
- Modify: `lib/shell/amazon.ts` (`fetchAmazonCharges` loop)

**Interfaces:**
- Produces:

```ts
export type PageDecision =
  | { kind: 'fetch-next'; body: string }
  | { kind: 'stop'; reason: 'empty-first-page' | 'past-cutoff' | 'limit' | 'last-page' | 'max-pages' };

export function decideAfterPage(input: {
  page: number;              // 1-based page just parsed
  pageCharges: number;       // charges parsed on this page
  pageCredits: number;
  oldestDateOnPage: string | null; // min date over this page's charges and credits
  chargesSoFar: number;      // including this page
  sinceDate: string;
  limit: number;
  nextPageBody: string | null;
  maxPages: number;
}): PageDecision;

export function finalizeCharges(
  charges: AmazonCharge[], credits: AmazonCharge[],
  window: { sinceDate: string; untilDate: string | undefined; limit: number },
): { charges: AmazonCharge[]; credits: AmazonCharge[] };
```

Order of checks matches today: empty first page, then past cutoff, then limit, then no next page, then `page >= maxPages`. On `empty-first-page` the shell records the capture and does not add the page's rows (it has none).

- [ ] **Step 1:** Tests in `lib/core/paging.test.ts`: one per `reason`, `fetch-next` when none apply, an empty page 2 continues (today's behavior), past cutoff wins over limit when both hold. `finalizeCharges`: Review Focus test 3 (charge on `sinceDate` kept, day before dropped, `untilDate` `2025-12-31` keeps a charge on that date), limit applies to charges only, credits are not limited. Run. Expected: FAIL, module missing.
- [ ] **Step 2:** Implement in `lib/core/paging.ts`. Rewrite the loop in `fetchAmazonCharges` to call `decideAfterPage` and `finalizeCharges`.
- [ ] **Step 3:** Run `bun run lint && bun run test`. Expected: PASS, characterization test unchanged.
- [ ] **Step 4:** Commit `refactor: move transaction paging decisions into the core`.

### Task 6: Scan planner, apply planning, and error messages in the core

**Files:**
- Create: `lib/core/scan.ts`, `lib/core/scan.test.ts`, `lib/core/apply.ts`, `lib/core/apply.test.ts`, `lib/core/errors.test.ts`
- Modify: `lib/core/errors.ts`, `entrypoints/background.ts`

**Interfaces:**
- Consumes: `matchCharges`, `matchRefunds`, `buildMemo`, `buildRefundMemo`, `buildSplits`, `findOriginalTransaction` (Task 3).
- Produces:

```ts
// lib/core/scan.ts
export const RECENT_SCAN_DAYS = 90;
export const YNAB_LOOKBACK_DAYS = 60;
export const MAX_DEBUG_CAPTURES = 3;
export function scanWindow(settings: Settings, today: string):
  { sinceDate: string; untilDate: string | undefined; ynabSinceDate: string };
export interface ScanMatches {
  charges: ChargeMatch[];      // digital removed
  refunds: ChargeMatch[];      // digital removed
  digitalSkipped: number;
  orderIdsToFetch: string[];   // charges then refunds, duplicates kept
  scanDebug: ScanDebug;
}
export function matchScan(input: {
  charges: AmazonCharge[]; credits: AmazonCharge[];
  transactions: YnabTransaction[]; maxDays: number;
}): ScanMatches;
export function buildScanResult(input: {
  matches: ScanMatches; orders: Map<string, AmazonOrder>;
  transactions: YnabTransaction[]; maxDays: number; captures: DebugCapture[];
}): { proposals: MatchProposal[]; counts: ScanCounts; message: string; debugCaptures: DebugCapture[] };

// lib/core/apply.ts
export function selectProposals(proposals: MatchProposal[], txnIds: string[]): MatchProposal[];
export function applyStartMessage(count: number): string;   // `Writing ${count} memos…`
export function applySummary(total: number, failures: number): string;

// lib/core/errors.ts
export const RECONNECT_MESSAGE = 'YNAB session expired. Reconnect YNAB in the popup.';
export function errorMessage(err: unknown): string;
export function missingSetupMessage(hasToken: boolean): string; // 'Pick a budget first.' | 'Connect YNAB in the popup first.'
```

`scanWindow`: with `year`, `sinceDate = ${year}-01-01`, `untilDate = ${year}-12-31`. Without, `sinceDate` is `today` minus 90 days, `untilDate` undefined. `ynabSinceDate` is `sinceDate` at `T12:00:00Z` minus 60 days, sliced to the date. Use `new Date(string)` arithmetic, never a clock read.

- [ ] **Step 1:** Write tests. `scanWindow`: `('2026-07-01', year null)` gives `2026-04-02` and `2026-02-01`; `year 2025` gives `2025-01-01`, `2025-12-31`, `2024-11-02`; `today '2026-03-01'` with year null crosses a month and a leap-free February correctly (`2025-12-01`, `2025-10-02`). `matchScan`: the digital filter by `D0` prefix on both lists and its count, `orderIdsToFetch` order, `scanDebug.candidates` include only Amazon payees and carry `hasMemo`. `buildScanResult`: the already-split rule, `invoicesUnparsed`, proposal order (charges then refunds), refund category recovery, Review Focus test 5 (no original in range gives no `→ was:` suffix), message `Found ${n} charges, matched ${m} transactions.`, `debugCaptures` capped at 3 in input order. `apply`: selection keeps proposal order, both summary forms. `errors`: each class and the generic `Error` and non-`Error` fallbacks. Run. Expected: FAIL, modules missing.
- [ ] **Step 2:** Implement. Rewrite `runScan` and `runApply` as: read settings and token, read the clock once (`new Date().toISOString()` for `today` and `lastScanAt`), call shell and core in today's order, write state in today's order.
- [ ] **Step 3:** Run `bun run lint && bun run test`. Expected: PASS, characterization test unchanged.
- [ ] **Step 4:** Commit `refactor: move scan and apply planning into the core`.

### Task 7: OAuth helpers in the core

**Files:**
- Create: `lib/core/oauth.ts`, `lib/core/oauth.test.ts`
- Modify: `lib/shell/oauth.ts`, `entrypoints/popup/main.ts` (imports), `README.md:49` (client ID path becomes `lib/core/oauth.ts`)

**Interfaces:**
- Produces:

```ts
export const YNAB_OAUTH_CLIENT_ID: string;      // moved verbatim
export const EXPIRY_MARGIN_MS = 5 * 60_000;
export interface StoredToken { accessToken: string; expiresAt: number }
export function oauthConfigured(clientId?: string): boolean;   // default YNAB_OAUTH_CLIENT_ID
export function buildAuthorizeUrl(clientId: string, redirectUri: string): string;
export function parseAuthRedirect(redirectUrl: string, nowMs: number): StoredToken | null;
export function isTokenUsable(token: StoredToken | undefined, nowMs: number): boolean;
```

- [ ] **Step 1:** Tests: URL equals today's string for a sample ID and redirect URI. Redirect `https://x.chromiumapp.org/#access_token=abc&expires_in=7200` at `nowMs 1_000` gives `{ accessToken: 'abc', expiresAt: 7_201_000 }`. Missing token, `expires_in=abc`, and an invalid URL give `null`. `isTokenUsable` is false at exactly `expiresAt - EXPIRY_MARGIN_MS` and true 1 ms before. `oauthConfigured('REPLACE_ME')` is false. Run. Expected: FAIL.
- [ ] **Step 2:** Implement. The shell reads `Date.now()` once per call and passes it in.
- [ ] **Step 3:** Run `bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 4:** Commit `refactor: move OAuth token logic into the core`.

### Task 8: Zod at every untyped boundary

**Files:**
- Create: `lib/core/schemas.test.ts`
- Modify: `package.json` (add `zod`), `lib/core/ynab.ts`, `lib/core/amazon.ts` (`__NEXT_DATA__` rows), `lib/core/state.ts`, `lib/core/oauth.ts`, `lib/shell/ynab.ts`, `lib/shell/storage.ts`, `lib/shell/oauth.ts`, `entrypoints/background.ts` (message listener), `scripts/parse-captures.ts`

**Interfaces:**
- Produces:

```ts
// lib/core/ynab.ts
export class YnabResponseError extends Error {}
export function parseBudgetsResponse(raw: unknown): YnabBudget[];          // endpoint '/budgets'
export function parseTransactionsResponse(raw: unknown): YnabTransaction[]; // endpoint '/transactions'
// message: `YNAB ${endpoint} response invalid at ${path}: ${issue.message}`
// path: issue.path joined with '.', e.g. 'data.transactions.3.amount'
// lib/core/state.ts
export function parseSettings(raw: unknown): Settings;    // per-field .catch(default)
export function parseSyncState(raw: unknown): SyncState;  // per-field .catch(default)
export function parseMessage(raw: unknown): Message | null;
// lib/core/oauth.ts
export function parseStoredToken(raw: unknown): StoredToken | null;
```

- `YnabTransaction` keeps only the fields the code reads: `id`, `date`, `amount`, `payee_name` (nullable), `memo` (nullable), `category_name` (nullable), `subtransactions` (optional `{ id }[]`). `cleared` and `approved` leave the type.
- The shell `request` returns `unknown` and the callers parse. The PUT response is not parsed.
- `errorMessage` returns the `YnabResponseError` message as is (generic `Error` branch).

- [ ] **Step 1:** Write `lib/core/schemas.test.ts`: each parser accepts a realistic value, ignores an extra field, and rejects (or defaults, per the spec table) a wrong-typed used field. `parseTransactionsResponse` with `amount: '12'` at index 3 throws `YNAB /transactions response invalid at data.transactions.3.amount: …`. `parseSettings({ maxDays: 'x', year: 2025 })` gives `maxDays: 7, year: 2025`. `parseSyncState(undefined)` equals `DEFAULT_STATE`. `parseMessage({ type: 'nope' })` is `null`. A `__NEXT_DATA__` list with one row where `formattedAmount` is a number skips that row and keeps the others. Review Focus test 4: a literal state object shaped like 0.1.1 writes (full proposal with `splits`, counts, `scanDebug`, one capture) round-trips through `parseSyncState` with `toEqual`. Run. Expected: FAIL.
- [ ] **Step 2:** Add `zod` (newest 4.x at least 14 days old). Record `background.js` size from `bun run build` first. Implement the schemas and wire the shell to them.
- [ ] **Step 3:** Add a characterization scenario `ynab malformed`: a transactions response with a string amount ends in `status: 'error'` and the `YnabResponseError` message. This is the one accepted behavior change, so it is new, not an edit to an old assertion. Run `bun run lint && bun run test`. Expected: PASS, every pre-existing characterization assertion unchanged.
- [ ] **Step 4:** Run `bun run build`. Compare `background.js` size. If Zod adds more than 60 kB, switch to `zod/mini` and re-run.
- [ ] **Step 5:** Commit `feat: parse untyped input with Zod at every boundary` with the size change in the body.

### Task 9: Property tests

**Files:**
- Create: `lib/core/matcher.property.test.ts`, `test/arbitraries.ts`
- Modify: `package.json` (add `fast-check`, and `@fast-check/vitest` if it supports Vitest 4.1)

**Interfaces:**
- Produces, `test/arbitraries.ts`: `orderIdArb` (`(D\d{2}|\d{3})-\d{7}-\d{7}`), `isoDateArb` (2020-01-01 to 2030-12-31), `dollarsArb` (0.01 to 9999.99, two decimals), `chargeArb`, `transactionArb` (Amazon payee, blank memo, outflow or inflow), `orderArb` (1 to 6 items, prices nullable).

- [ ] **Step 1:** Write properties: no transaction ID appears in two matches (`matchCharges` and `matchRefunds`), every match has `txn.amount === sign * round(charge.amount * 1000)` and a day difference in `[-1, maxDays]`, `buildSplits` non-null implies the split amounts sum to `dollarsToOutflowMilliunits(charge)`, `buildMemo` and `buildRefundMemo` output is at most 480 characters and ends with `[${orderId}]`.
- [ ] **Step 2:** Run `bun run test lib/core/matcher.property.test.ts`. Expected: PASS. If one fails on real-shaped input, mark it `it.fails` with the shrunk counterexample in a comment and record it for the final report. Do not fix the code.
- [ ] **Step 3:** Commit `test: property tests for matcher invariants`.

### Task 10: Remove the characterization test and finish

**Files:**
- Delete: `entrypoints/background.characterization.test.ts`, `test/fixtures/scan-world.ts`
- Modify: `entrypoints/background.ts` (drop the `export` on `runScan` and `runApply` if nothing else imports them), `README.md`

- [ ] **Step 1:** For each characterization scenario in Task 2 and Task 8, name the core test that covers the same rule. Put the mapping in the commit body. A scenario with no core counterpart gets a core test first. The order of storage writes has no core counterpart by design. It stays covered by `background.ts` being a straight sequence, so say that in the mapping.
- [ ] **Step 2:** Delete the files. README: Bun install (`bun install`, `bun run build`), `bun run test`, `bun run lint`, the `lib/core` / `lib/shell` split in two sentences, `bun scripts/parse-captures.ts`, and point the "fragile piece" paragraph at `lib/core/amazon.ts` and `lib/core/amazon.test.ts` instead of `scripts/smoke.ts`.
- [ ] **Step 3:** Run `bun install --frozen-lockfile && bun run lint && bun run typecheck && bun run test && bun run build && bun run zip`. Expected: all succeed.
- [ ] **Step 4:** Commit `test: drop temporary characterization test; docs for Bun workflow`.
- [ ] **Step 5:** Final report to the owner: every `it.fails` with its defect, every line-level lint disable, the bundle size change, and the reminder to reload the extension and do one manual scan in Chrome (the shell has no automated tests).
