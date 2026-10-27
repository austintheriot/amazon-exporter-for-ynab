# Popup rewrite: Lit components on a TEA core

Date: 2026-10-27
Status: draft

## Intent

The popup works, but its wiring causes real bugs. It keeps state in module-level `let` variables, rebuilds the whole DOM on every change, and performs IO inside the view. Results: stale data can overwrite fresh data, focus jumps away on every update, errors disappear, and none of the popup logic has tests.

The owner wants the popup rewritten with Lit components on The Elm Architecture (TEA): a pure `update` function, effects as data, one interpreter, and a pure view model. The rewrite also adds three things the owner chose during an expert review: a list of unmatched charges with reasons, per-row checkboxes on matches, and scan results that remember their budget.

The fork does not merge with upstream (`jparavisini/amazon-exporter-for-ynab`), so divergence is acceptable.

## Goals

1. **TEA core in `lib/core/popup/`.** A closed `Msg` union, a `Model` union, an `Effect` union, and `update(model, msg): [Model, Effect[]]`. All popup decisions live here. The existing purity lint on `lib/core/**` covers these files.
2. **One interpreter.** `createPopupRuntime(services)` owns the model, runs effects through an injected `Services` bag, and feeds results back as messages. Components never call `browser.*`, `fetch`, storage, or the clock.
3. **Lit components, light DOM.** One `<amex-app>` container plus presentational children. Children receive data as properties and emit one composed `msg` `CustomEvent` that carries a `Msg`. Every component renders into light DOM (`createRenderRoot() { return this; }`). The one global stylesheet applies everywhere, and ARIA ID references work.
4. **Per-row checkboxes.** Each match that is not yet applied gets a checkbox. All pending matches are checked by default. A check-all box above the list toggles every pending row and shows the indeterminate state when only some rows are checked. Apply sends only the checked transaction IDs. The Apply label counts checked rows: "Apply 3 memos to YNAB".
5. **Unmatched charges with reasons.** After a scan, the popup lists every Amazon charge and refund that has no match. Each row shows the amount, the date, and a one-line reason (see "Unmatched reasons"). The list sits in a `<details>` element below the matches, collapsed by default, with the count in its summary: "Not matched (10)".
6. **Scan results remember their budget.** `SyncState` stores the budget ID the scan ran against. When the selected budget differs, Apply is disabled and the popup says why: "These matches are from budget Household. Scan again to match against Personal."
7. **Reset aborts in-flight requests.** The run guard owns an `AbortController` per run generation. `cancelAll()` aborts it. YNAB and Amazon fetches in the background take the signal. After Reset, no new request starts and no response from the cancelled run is written to state. A memo write that already reached YNAB can still land. That is acceptable: the next scan sees the memo and does not propose that YNAB transaction again (`matcher.ts:117`).
8. **State bugs fixed and tested.** Each bug below gets a failing `update` or runtime test first:
   - The storage listener registers before init, so a stale init snapshot can overwrite a newer `syncState`.
   - Year and order-limit changes save but never redraw.
   - An older budget-list response can replace a newer one (fix: request ID on `loadBudgets`, stale replies dropped).
   - Whole-settings saves can lose a concurrent change (fix: `persistSettings` effect carries a patch, not the whole object).
   - Errors are swallowed (`void` on promises with no catch). Every effect failure becomes a `Msg`.
   - The year select shows "Recent orders" when the saved year is outside the five-year window (fix: include the saved year as an option).
   - Double-clicking Apply can send two apply messages (fix: `update` ignores Apply while a send is pending or status is busy).
   - The order-limit input clamps silently (fix: show the clamped value and a hint "Max 200").
9. **Accessibility.**
   - One persistent `role="status"` element, always mounted, holds scan and apply progress. It never re-mounts.
   - Lit's patching keeps focus in place across updates.
   - Every disabled control shows a visible reason next to it.
   - Section headings (`h2`) and a `<main>` landmark.
   - Contrast: input and checkbox borders reach at least 3:1. Error text reaches at least 4.5:1, with no opacity.
   - Dark mode through `light-dark()`. `color-scheme: light dark` already exists.
10. **Copy and glossary.** One term per concept across all strings:
    - **charge**: money Amazon took. **refund**: money Amazon returned. **order**: an Amazon order.
    - **YNAB transaction**: a row in YNAB. Never "txn", "transaction" alone, "invoice", "credit", or "proposal" in UI text.
    - **match**: a charge or refund paired with a YNAB transaction. **memo**: the text written to YNAB.
    - Errors use plain words, say whether anything changed, and name the next button to press. Raw API error text goes to the console and to the debug export, never to the screen.
    - Plurals come from one helper (`Intl.PluralRules`), not string concatenation.
    - Reset keeps its current behavior. Its label is "Stop" while a scan or apply runs, and "Clear results" otherwise.
11. **HTML parser out of the popup bundle.** `AMAZON_LOGIN_URL` and `AMAZON_ORIGINS` move from `lib/core/amazon.ts` to a new `lib/core/amazon-config.ts`. The popup chunk must not contain cheerio. A build check confirms this: grep the built popup chunk for `cheerio` and `parse5`.
12. **YNAB sign-in runs in the background.** Today the popup calls `launchWebAuthFlow`. Chrome can close the popup when the sign-in window takes focus, and then the code after `await` never runs. The owner does not know if Connect YNAB works today. The rewrite moves the interactive flow to the background worker behind a `connectYnab` message. The popup learns the result through storage, so the result reaches the popup whether it survives or not. See "YNAB sign-in status".

## Non-goals

- Changing size or layout. Keep `body { width: 420px }`, 13px text, and today's section order: settings, Amazon access, sync, footer. The owner reviewed bigger mockups and chose to keep today's size.
- Collapsing setup into a summary line. The owner rejected this.
- An Apply confirm step. The owner chose checkboxes only.
- Fixing matcher bugs. See the matching-fix leads. Unmatched reasons describe what today's matcher does, including its bugs.
- A side panel. The popup stays a popup.
- Moving long-running work out of the background worker or changing its message protocol beyond what goals 6, 7, and 12 need.
- A store library, Effect-TS, `@lit/context`, `@lit/task`, or a memo library.
- `experimentalDecorators`. Use `static properties`.

## Anti-goals

- **A double write to YNAB.** No path may send the same transaction ID to YNAB twice in one apply, and Apply must stay safe after Reset. Today the memo-blank filter (`matcher.ts:117`) blocks re-proposal of an applied transaction. Do not weaken it.
- **Apply against the wrong budget.** The budget check runs in the popup and again in the background `runApply`.
- **IO in components or in `lib/core/popup/`.** No `browser.*`, `fetch`, `Date.now()`, argument-less `new Date()`, `Math.random()`, or storage access. The view model takes the current time as input.
- **Shadow DOM.** It breaks the global stylesheet and ARIA ID references.
- **A test suite that asserts effect call order or Lit internals.** Test `update` by its returned model and effects, and test components through what they render and the `msg` events they emit.

## Current state

- `entrypoints/popup/main.ts` (about 340 lines): `el()` helper, module-level state, `render()` with `app.replaceChildren`, IO in click handlers, a `storage.onChanged` listener for `syncState`.
- `entrypoints/popup/style.css`: 420px, 13px, `ul.proposals` scrolls at `max-height: 300px`.
- `entrypoints/background.ts`: `runScan`, `runApply(txnIds)`, and `reset`, guarded by `createRunGuard()` from `lib/core/run-guard.ts`. `runApply` already applies only the IDs it receives.
- `lib/core/state.ts`: zod schemas for `Settings`, `SyncState`, and `Message` (`scan`, `apply{txnIds}`, `reset`). `SyncState.scanDebug` holds every charge, every credit, and every Amazon-payee YNAB candidate (`id`, `date`, `amount`, `payee`, `hasMemo`).
- `lib/core/matcher.ts`: exact-amount match within `[-1, maxDays]` days, Amazon payee only, blank memo only, nearest date first, each YNAB transaction claimed once, charges in date order.
- `lib/shell/oauth.ts`: `authorize(interactive)`, `getAccessToken()` (stored or silent renewal), `isConnected()`, `disconnect()`. Token key `oauthToken`.
- Tests: Vitest 4.1.11 with `WxtVitest()`, node environment, `fakeBrowser`. No DOM environment and no Lit in `node_modules`.

## Design

### Model

```ts
type Remote<Value, Failure> =
  | { kind: 'idle' }
  | { kind: 'loading'; requestId: number }
  | { kind: 'loaded'; value: Value }
  | { kind: 'failed'; failure: Failure };

type YnabConnection =
  | { kind: 'not-configured' }
  | { kind: 'disconnected'; failure: string | null }
  | { kind: 'connecting' }
  | { kind: 'connected'; budgets: Remote<YnabBudget[], string> };

type Model =
  | { kind: 'booting' }
  | { kind: 'boot-failed'; message: string }
  | {
      kind: 'ready';
      today: string;              // YYYY-MM-DD, from the clock at boot
      now: string;                // ISO instant, refreshed by a tick message
      settings: Settings;
      sync: SyncState;
      ynab: YnabConnection;
      amazonGranted: boolean;
      selection: ReadonlySet<string>;   // checked YNAB transaction IDs
      selectionScanAt: string | null;   // lastScanAt the selection belongs to
      applyPending: boolean;
      nextRequestId: number;
    };
```

These shapes are a sketch. The builder can change field names. The builder must keep these properties: `settings` is never undefined in `ready`, and stale replies are detectable by request ID.

### Messages

`Msg` names are past tense and describe what happened: `booted`, `bootFailed`, `syncStateChanged`, `settingsChanged`, `tokenChanged`, `budgetsLoaded{requestId}`, `budgetsFailed{requestId}`, `connectYnabPressed`, `disconnectYnabPressed`, `budgetPicked`, `yearPicked`, `orderLimitEntered`, `connectAmazonPressed`, `amazonPermissionResolved`, `scanPressed`, `applyPressed`, `resetPressed`, `rowToggled{txnId}`, `allToggled`, `exportPressed`, `effectFailed{effect, message}`.

### Effects

`loadBudgets{requestId}`, `persistSettings{patch}`, `sendBackground{message}`, `requestAmazonPermission`, `openAmazonLogin`, `disconnectYnab`, `downloadFile{name, json}`, `logError{context, detail}`.

Boot reads settings, sync state, the token, and Amazon permission in one shell step and dispatches `booted`. The runtime subscribes to `storage.onChanged` before it reads, and queues changes until `booted` lands, so a change during boot is never lost.

### Selection rules

- When `sync.lastScanAt` differs from `selectionScanAt`, the selection resets to every pending match (not in `appliedTxnIds`).
- A row that becomes applied leaves the selection and shows as applied with a disabled checkbox.
- `allToggled` checks every pending row, unless every pending row is already checked, in which case it unchecks all.
- The selection lives only in the popup model. It does not persist. Closing the popup resets it to all checked on the next open. (Builder's call to persist it if that turns out simple.)

### Unmatched reasons

A new pure function in `lib/core/unmatched.ts`:

```ts
explainUnmatched(input: {
  scanDebug: ScanDebug;
  proposals: MatchProposal[];
  maxDays: number;
}): UnmatchedEntry[]
```

It returns one entry for each charge and each credit in `scanDebug` whose order ID and amount appear in no proposal. Each entry has a `reason`:

| Reason | Condition | Text |
|---|---|---|
| `digital` | order ID starts `D0` | "Digital order, skipped." |
| `order-unreadable` | matched by amount and date, but no proposal (order details failed) | "Matched, but the order page could not be read. Download the debug file." |
| `already-has-memo` | an amount and date match exists, but every such YNAB transaction has a memo | "The matching YNAB transaction already has a memo." |
| `taken` | an amount and date match exists, but another charge claimed it | "Another charge with the same amount took the only matching YNAB transaction." |
| `outside-window` | an amount match exists, but outside `[-1, maxDays]` days | "A YNAB transaction has this amount, but its date is N days away (limit: maxDays)." |
| `no-amount-match` | no Amazon-payee YNAB transaction has this exact amount | "No Amazon YNAB transaction for this amount. Closest: $X on DATE." (omit "Closest" when there are no candidates) |

It must not re-implement matching rules. Refactor `lib/core/matcher.ts` to export the pieces it needs: the candidate predicate (sign, Amazon payee, blank memo), the date-window predicate, and the one-to-one claiming pass. `explainUnmatched` maps `scanDebug.candidates` into the minimal shape those functions take. The candidate fields in `ScanDebug` (id, date, amount, payee, `hasMemo`) are all the matcher reads, so `ScanDebug` needs no new fields. If the builder finds the matcher reads more, add the field to `ScanDebug` rather than approximating. The matcher refactor must leave every existing matcher test green with no pin changes.

When `scanDebug` is `null` (fresh install, after Reset, or state from before this change), the unmatched list is hidden.

It must agree with `matchScan`: a property test asserts that for any input, an entry is unmatched by `explainUnmatched` exactly when `matchScan` plus `buildScanResult` produce no proposal for it. Charge order IDs can repeat (split shipments), so identity is order ID plus date plus amount plus kind.

### Budget binding

`SyncState` gains `scanBudgetId: string | null` and `scanBudgetName: string | null`, each with a zod `catch` default of `null`. `runScan` reads both from settings when the scan starts, and writes them with the results. A budget change during a scan does not move the results to the new budget. `resetState` clears both.

`runApply` refuses when `scanBudgetId` is `null` or differs from `settings.budgetId`, and sets an error message. A scan stored before this change has `null`, so the owner must scan once more after the upgrade. The view model disables Apply with the reason text in goal 6. When `scanBudgetName` is `null` or empty, the text says "a different budget" instead of the name. (My call: refusing on `null` keeps the background check free of holes, and the cost is one rescan.)

### YNAB sign-in status

A new storage key `ynabAuth` holds `{ kind: 'idle' } | { kind: 'connecting'; startedAt: string } | { kind: 'failed'; message: string }`, parsed with zod and a `catch` default of `idle`. The background writes `connecting` before `launchWebAuthFlow`, writes `idle` on success (after it stores `oauthToken`), and writes `failed` on cancel or error.

The popup watches `ynabAuth` and `oauthToken`. `YnabConnection` derives from both. While `connecting`, Connect YNAB is disabled with the reason "Sign-in window is open." A `connecting` value older than 5 minutes counts as `idle`, because a service-worker restart kills the flow without writing `failed`. The background ignores a `connectYnab` message while a fresh `connecting` value exists, so a second flow cannot start. (My call; the 5-minute limit is the builder's to tune.)

### Abort on Reset

`createRunGuard` keeps its current contract (`start`, `cancelAll`, `isCurrent`) and adds `signal(run): AbortSignal`. `cancelAll` aborts the current controller and creates a new one. `lib/shell/ynab.ts` and `lib/shell/amazon.ts` fetch functions take an optional `signal`. An aborted fetch rejects with an `AbortError`. `runScan` and `runApply` treat that as a silent stop, not an error message.

### Files

- `lib/core/popup/model.ts`, `msg.ts`, `effect.ts`, `update.ts`, `view-model.ts`, plus tests.
- `lib/core/unmatched.ts` plus tests, including the property test.
- `lib/core/copy.ts`: every user-facing string and the plural helper. Existing messages in `lib/core/apply.ts`, `errors.ts`, and `scan.ts` move to the glossary terms.
- `lib/core/amazon-config.ts`: `AMAZON_LOGIN_URL`, `AMAZON_ORIGINS`.
- `lib/shell/popup-services.ts`: real `Services` (storage with watch, YNAB API, Amazon permission, tabs, background messaging, file download, logger, clock).
- `entrypoints/popup/runtime.ts`: `createPopupRuntime(services)` returning `{ getModel, dispatch, subscribe, dispose }`.
- `entrypoints/popup/components/*.ts`: `<amex-app>`, `<amex-settings>`, `<amex-amazon>`, `<amex-sync>`, `<amex-match-list>`, `<amex-unmatched-list>`.
- `entrypoints/popup/main.ts`: wires services, runtime, and `<amex-app>`. Nothing else.
- `entrypoints/background.ts`: `connectYnab` message, budget check, abort wiring.

### Testing

- `update`, `view-model`, `unmatched`, and `copy` tests run in the node environment with no DOM.
- `runtime` tests use fake `Services` objects built per test. They assert on the resulting model, not on call order. They cover the boot race and stale budget replies.
- Component tests use a DOM environment selected per file (`// @vitest-environment happy-dom`). Keep these few: check-all toggling, the indeterminate state, the persistent status element, disabled reasons, and `msg` event payloads. Query by role and label text.
- Background changes (budget check, abort, `connectYnab`) get tests where the existing harness allows, using `fakeBrowser`.
- Manual check in Chrome before merge: connect YNAB, scan, uncheck a row, apply, reset during apply, switch budget after scan, dark mode.

## Constraints

- Bun 1.4.2, WXT 0.21, Vitest 4.1.11, TypeScript 6.0.3 strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`, typescript-eslint strictTypeChecked.
- New dependencies: `lit` (runtime) and `happy-dom` (dev). Each version, and every new transitive package, must be at least 14 days old. Pin exact versions.
- No TypeScript non-null `!` in production code. No lint suppressions.
- Chrome popup: maximum 800x600. The popup closes on blur, so no flow may depend on code after an `await` that opens a window, tab, permission prompt, or download.
- MV3 default CSP. Lit works under it.
- `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build` pass at every commit.

## Left to the builder

- Exact field names and the internal shape of `Model`, as long as the properties above hold.
- Component split below `<amex-app>`.
- Whether the `now` tick exists, and its interval, if a "scanned N minutes ago" line is shown. Showing scan age is optional.
- CSS details inside the fixed width, font size, and section order.
- The happy-dom version, within the age rule.
