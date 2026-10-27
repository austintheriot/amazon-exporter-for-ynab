# Bun, functional core / imperative shell, and a Vitest suite

Date: 2026-10-26
Status: approved 2026-10-26

## Intent

Amazon order matching misses some of the owner's orders. The owner wants to fix the matching logic, but first wants the code in a shape that makes that fix easy and safe. This work is that preparation. It changes tooling and structure. It does not change behavior.

The fork goes its own way. It will not merge from or send changes to the upstream repository (`jparavisini/amazon-exporter-for-ynab`), so divergence in tooling is acceptable.

## Goals

1. Bun is the package manager and script runner. `bun.lock` replaces `package-lock.json`. `tsx` goes away.
2. Vitest is the test runner. `scripts/smoke.ts` goes away, and its cases move into Vitest test files.
3. All decision logic lives in a pure core: no `fetch`, no `browser.*`, no `Date.now()`, no argument-less `new Date()`, no `Math.random()`. The core takes every external value (fetched pages, YNAB transactions, settings, the current date or time) as plain data and returns results as data.
4. A thin shell performs the IO: Amazon fetches, YNAB API calls, `browser.storage`, `browser.identity`, the clock. The shell reads the clock once per operation and passes the value into the core.
5. The core has thorough automated tests. CI runs them.
6. A lint rule bans IO in `lib/core/`. The owner asked for this. CI runs the lint.
7. Zod parses every untyped value that enters the program. The owner asked for this. See "Zod at the boundaries".

## Non-goals

- Fixing the matching bug. That is the next piece of work, and it starts from this structure.
- Tests against live Amazon or the live YNAB API. The owner ruled these out. No test may make a network request.
- Tests of the shell. Typecheck, build, and a manual run in Chrome cover it.
- Refactoring the popup DOM code (`entrypoints/popup/main.ts`). It changes only where imports move.
- Replacing WXT. WXT already builds on Vite and handles the manifest, MV3 bundling, and dev reload. "Move to Vite" is already true.
- Committing real Amazon pages or YNAB data. They contain personal data.

## Anti-goals

- **Any change in matching output.** For the same Amazon pages, YNAB transactions, settings, and date, the refactored code must produce the same proposals, memos, splits, counts, and debug data as today, including today's bugs. A behavior change hidden in a refactor makes the later fix impossible to judge.
- A mock-heavy shell test suite. Do not add interfaces or fakes for IO only so that the shell can be tested.
- Tests that assert call order or request strings instead of domain results.

## Current state

- `lib/matcher.ts` is already pure: matching by amount and date window, memo building, refund memos, splits, finding the original purchase.
- `lib/amazon.ts` mixes pure parsers (`parseTransactionsPage`, `parseInvoice`, `buildNextPageBody`) with fetch code. `fetchAmazonCharges` decides inside its fetch loop when to stop paging and how to filter results.
- `entrypoints/background.ts` `runScan` mixes decisions (scan window from settings and `Date.now()`, the 60-day YNAB lookback, the digital-order skip, building proposals, counts, the `scanDebug` snapshot, the status message) with fetches and storage writes. `runApply` mixes proposal selection and the summary message with YNAB writes.
- `lib/oauth.ts` mixes token expiry checks and redirect parsing with `browser.identity` and `Date.now()`.
- `lib/state.ts` holds types, defaults, and `browser.storage` access.
- `scripts/smoke.ts` is a homemade runner with synthetic fixtures. `scripts/parse-captures.ts` runs `parseInvoice` against a downloaded debug file.
- CI (`.github/workflows/ci.yml`, `release.yml`) uses Node 22 and npm.

## Decided structure

### Directories

- `lib/core/`: pure modules. Nothing in this directory imports from `lib/shell/`, from `wxt`, or uses `browser`.
- `lib/shell/`: IO modules. They import from `lib/core/`.
- `entrypoints/`: WXT entry points. They wire shell to core.

### Core modules (names are the builder's call where marked)

- **Types and pure helpers** that today live in `lib/amazon.ts`, `lib/ynab.ts`, and `lib/state.ts` move to core: `AmazonCharge`, `AmazonItem`, `AmazonOrder`, `ScanCounts`, `DebugCapture`, `YnabTransaction`, `YnabSplit`, `YnabBudget`, `Settings`, `SyncState`, `ScanDebug`, `Message`, `DEFAULT_SETTINGS`, `DEFAULT_STATE`, `dollarsToOutflowMilliunits`.
- **Error classes** `AmazonSessionError` and `YnabAuthError` move to core so that the pure `errorMessage(err)` mapping can live there. The shell throws them.
- **Matcher:** `lib/matcher.ts` moves to core as is.
- **Amazon parsers:** `parseTransactionsPage`, `parseInvoice`, `buildNextPageBody`, the session check (sign-in page detection), and the "We're sorry" invoice check move to core. They take HTML or a Cheerio document and return data or `null`. Cheerio is pure and stays allowed in core.
- **Paging decision:** a pure function decides, after each Transactions page, whether to fetch the next page or stop, and why. Inputs: the page number, the parsed charges and credits of that page, the count so far, `sinceDate`, `limit`, the max page count, and the next-page body (or `null`). A pure function also does the final window filter and limit (`inWindow`, `slice(0, limit)`), and decides when to record a debug capture for an empty first page.
- **Scan planner:** scanning has two phases, because invoices are fetched only for matched orders. The core exposes the two phases as two functions, and the second takes the first's result as input so that the order is in the types:
  1. `scanWindow(settings, today)` returns `sinceDate`, `untilDate`, and the YNAB `since` date (60 days before `sinceDate`). `today` is the UTC ISO date that the shell supplies (`new Date().toISOString().slice(0, 10)`), as today's code does. A local date shifts the window.
  2. A match phase takes charges, credits, YNAB transactions, and settings. It returns the charge matches and refund matches with digital orders (`D0` prefix) removed, the `digitalSkipped` count, the order IDs to fetch invoices for, and the `scanDebug` snapshot.
  3. A proposal phase takes the match-phase result, the fetched orders, the YNAB transactions, and settings. It returns the proposals, the `ScanCounts`, and the completion message.
- **Apply planning:** a pure function selects proposals for the given transaction IDs, and a pure function builds the summary message from the total and failure counts.
- **OAuth helpers:** a pure function builds the authorize URL from the client ID and redirect URI, a pure function parses the redirect URL into a token with an absolute expiry given `nowMs`, and a pure function decides whether a stored token is still valid given `nowMs`.

### Shell modules

- `lib/shell/amazon.ts` (name is the builder's call): `fetchPage` with timeout and credentials, the paging loop that calls the core paging decision, invoice fetching with concurrency 4, and the per-invoice catch that turns a failed fetch into "no order".
- `lib/shell/ynab.ts`: `request`, `getBudgets`, `getTransactions`, `updateTransactionMemo`.
- `lib/shell/storage.ts`: `getSettings`, `saveSettings`, `getState`, `setState`.
- `lib/shell/oauth.ts`: `authorize`, `getAccessToken`, `isConnected`, `disconnect`, using the core OAuth helpers.
- `entrypoints/background.ts`: `runScan` and `runApply` become sequences of shell calls and core calls. Progress messages and storage writes stay here.

### Behavior preservation

- Every observable result stays the same: proposals, memo text, splits, counts, `scanDebug`, `debugCaptures` (including the 500,000-character HTML cap and the first-3 limit), status messages, the order of storage writes, the order of proposals, and the decision to disconnect on `YnabAuthError`.
- The matcher's use of `new Date(string)` to compute day differences is date parsing, not a clock read. It stays as is.
- Port the smoke cases to Vitest before moving code, and keep them green at every step, so they act as characterization tests.
- Before extracting `runScan` and `runApply`, write a temporary characterization test of today's `entrypoints/background.ts`. The owner approved this. It replaces `fetch` and `browser.storage` with in-memory fakes, serves synthetic Amazon pages and YNAB responses, and records the full sequence of stored states and YNAB writes. It must pin at least: the 90-day window and the year window, the 60-day YNAB lookback, the `D0` skip and `digitalSkipped`, the already-split rule, `invoicesUnparsed`, the `scanDebug` candidates, the capture order and the first-3 cap, the completion and apply messages, the order of storage writes, and the disconnect on `YnabAuthError`. Fix the clock in this test. The test must pass unchanged against the refactored code. Delete it at the end, after the new core tests cover every item in the list above. It never makes a network request. It is the one exception to "no shell tests" and "no mock-heavy suites".

## Tooling

- **Bun:** `bun install`, a committed `bun.lock`, `package-lock.json` deleted, `packageManager` set in `package.json`. Scripts run with `bun run <script>`. `scripts/parse-captures.ts` runs with `bun scripts/parse-captures.ts <file>`. Remove `tsx`.
- **Vitest:** `vitest.config.ts` uses the `WxtVitest()` plugin from `wxt/testing` so that `@/` imports resolve. Scripts: `test` (`vitest run`) and `test:watch` (`vitest`). Pick a Vitest major that supports the installed Vite major, and check that compatibility before installing.
- **Property tests:** add `fast-check` (with `@fast-check/vitest` if it supports the installed Vitest) for invariants. This was my call, not the owner's request.
- **Runtime (my call):** Bun is the package manager and script runner. WXT, Vitest, and `tsc` keep running on Node through their `#!/usr/bin/env node` shebangs. Do not pass `--bun`. Reason: Vitest has known gaps on the Bun runtime, and the build output must not change.
- **Lockfile migration:** let `bun install` migrate from `package-lock.json` so that every dependency keeps its current version. Do not do a fresh resolve. A newer Cheerio can change parser output.
- **CI:** both workflows use `oven-sh/setup-bun` with a pinned Bun version, keep `actions/setup-node` pinned to Node 22, run `bun install --frozen-lockfile`, then `bun run test`, `bun run typecheck`, and `bun run build` (CI) or `bun run zip` (release).
- **README:** replace npm commands with Bun commands. Mention `bun run test` and `bun run lint`.

### Lint: no IO in core

- The project has no linter today. Add ESLint (flat config, `eslint.config.ts` or `.js`) with `typescript-eslint`. Run it as `bun run lint`, in CI before the tests, and fail on any error.
- A config block scoped to `lib/core/**` bans:
  - globals through `no-restricted-globals`: `fetch`, `browser`, `chrome`, `window`, `document`, `localStorage`, `sessionStorage`, `indexedDB`, `XMLHttpRequest`, `WebSocket`, `setTimeout`, `setInterval`, `queueMicrotask`, `console`.
  - syntax through `no-restricted-syntax`: `Date.now()`, `new Date()` with zero arguments, `Math.random()`, `performance.now()`, `crypto.getRandomValues()`, `crypto.randomUUID()`.
  - imports through `no-restricted-imports`: anything under `lib/shell` (by `@/lib/shell` and relative paths), `wxt` and `wxt/*`, `node:*`, `fs`, `path`.
- Every ban message names the rule ("lib/core is pure") and the replacement ("take the value as a parameter; the shell supplies it").
- `new Date(string)` for date parsing stays allowed. The matcher uses it for day differences.
- The general lint (outside the core block) starts from `typescript-eslint`'s recommended rules. Existing violations outside the core rules get fixed only when the fix is mechanical and behavior-neutral. Otherwise turn the rule off with a comment that says why. The goal is the core ban, not a style cleanup. (My call.)
- `console` is banned in core. Today `lib/matcher.ts` and the parsers do not log, so this costs nothing.

### Zod at the boundaries

Zod (v4) replaces every `as` cast on untyped input. Schemas live in `lib/core/` (Zod is pure). The shell hands the raw `unknown` to a core parse function. Types come from the schemas through `z.infer` where the schema is the source of truth.

Boundaries and failure policy:

| Input | Today | With Zod |
|---|---|---|
| YNAB API response (`/budgets`, `/transactions`) | `body.data` cast to the type, unchecked | Parse the fields the code uses. On failure, throw an error that names the endpoint and the Zod issue path. The scan fails with that message. |
| `__NEXT_DATA__` JSON on the Transactions page | Optional chaining, rows with missing fields are skipped | Parse each row on its own with `safeParse`. Skip bad rows, as today. A missing list gives an empty result, as today. |
| `browser.storage` settings and state | Stored object spread over defaults, unchecked | Parse each field with its default. A field that fails falls back to its default. The other fields keep their stored values. |
| Stored OAuth token | Cast to `StoredToken` | Parse. On failure, treat as no token (the user reconnects). |
| OAuth redirect hash parameters | `URLSearchParams` and `Number()` | Parse the `access_token` and `expires_in` pair. On failure, return `null`, as today. |
| Runtime messages to the background (`Message`) | Cast | Parse. Ignore a message that fails. |
| Debug file in `scripts/parse-captures.ts` | Cast | Parse. On failure, print the issue and exit 1. |

Rules:

- Object schemas accept unknown extra keys (Zod v4 default `z.object` strips them, which is fine). They never reject a response because YNAB or Amazon added a field.
- Schemas require only the fields the code reads. A schema that requires an unused field adds a new failure mode for no gain.
- **Behavior on valid input does not change.** Behavior on invalid input changes in two places: a malformed YNAB response now fails the scan with a clear error instead of passing bad data into matching, and a corrupt stored setting now falls back to its default per field. The owner accepted these two changes.
- Zod does not parse HTML. Cheerio extraction stays. Where an extracted string becomes a number or date (amounts, ISO dates, order IDs), a small Zod schema or a pure helper may validate it, as long as the parser output on today's fixtures stays identical.
- Check the bundle size of `background.js` before and after. Report the change. Use `zod/mini` only if the full `zod` adds more than 60 kB to `background.js`.

## Test suite

Test files live next to the code they test (`lib/core/matcher.test.ts`). The builder can choose a separate `test/` directory instead, as long as it is one convention.

Required coverage, all with synthetic fixtures:

- **Matcher:** exact amount match, the date window edges (`-1` day and `maxDays`), closest-date tie-break, each transaction claimed once, sort by charge date, the Amazon payee pattern, skip transactions with a non-blank memo, outflow versus inflow sign, `findOriginalTransaction` by memo and by amount.
- **Memos:** comma join, the order ID suffix, truncation at 480 characters with the order ID kept.
- **Refund memos:** full refund, partial refund that singles out one item inside the tax band, partial refund with zero or several candidates, the `was: <category>` suffix.
- **Splits:** fewer than 2 items, charge not equal to the order total, a missing price, item prices that exceed the charge (returns `null`), the tax and shipping remainder, splits that sum to the charge.
- **Parsers:** the markup Transactions page and the `__NEXT_DATA__` JSON page, charges versus credits in each, digital order IDs, the next-page body and its absence, the sign-in page, the modern invoice, the legacy print invoice, the product-link fallback, unpriced items, and malformed input that returns `null`.
- **Paging decision:** stop on an empty first page (with a capture), stop past `sinceDate`, stop at `limit`, stop with no next page, stop at the max page count, continue otherwise. The final window filter and limit.
- **Scan planner:** `scanWindow` with and without a year, the 60-day YNAB lookback across a year boundary, digital orders skipped and counted, an already-split transaction gets no splits, a matched order with no invoice counts as `invoicesUnparsed`, refund proposals use the original purchase's category, the `scanDebug` snapshot, the completion message.
- **Apply planning:** selection by transaction ID, the summary message with and without failures.
- **OAuth helpers:** URL building, redirect parsing (valid, missing token, non-numeric `expires_in`), expiry with the margin.
- **Error mapping:** each error class and the generic fallback.
- **Property tests:** no YNAB transaction appears in two matches, every match has equal amounts and a date inside the window, splits always sum to the charge when not `null`, memos never exceed 480 characters and always end with the order ID. Generators produce real input shapes: order IDs match `(D\d{2}|\d{3})-\d{7}-\d{7}`, dates are valid ISO dates, amounts have two decimal places. (My call.) When a property fails on real-shaped input against today's code, do not fix the code. Mark the case with `it.fails`, add a comment that names the defect and the input, and list it in the final report. It feeds the matching fix.
- **Core purity lint test:** a Vitest test runs ESLint (through its Node API) on small fixture sources placed under the `lib/core/` rule scope, one per banned form, and asserts that each produces the expected rule error. A clean fixture produces none. This proves the ban fires, so that a config mistake cannot silently disable it.
- **Zod schemas:** each schema accepts a realistic valid value, rejects a value with a wrong-typed used field, and keeps unknown extra fields from breaking the parse. The `__NEXT_DATA__` row schema skips a bad row and keeps the good rows.

## Left to the builder

- Exact file and function names inside `lib/core/` and `lib/shell/`, within the shape above.
- The step order, as long as each step compiles and the suite stays green.
- Fixture organization (inline strings versus fixture files).
- Whether `parse-captures.ts` stays in `scripts/` or moves.
