# Amazon Exporter for YNAB

Chrome extension that matches your Amazon order history to your [YNAB](https://www.ynab.com/) transactions and enriches them with what you actually bought.

Amazon transactions land in YNAB as an amount and the payee "Amazon" — nothing else. This extension fills the gap:

- **Item-name memos.** Each matched charge gets a memo listing the order's items, with the Amazon order ID appended for easy lookup (`Echo Dot (5th Gen) [111-1234567-7654321]`).
- **Refund attribution.** Refund credits are matched to YNAB inflows. A full-order refund lists the returned items; a partial refund names the single item whose price fits the amount, or falls back to listing the order's items. When the original purchase can be found, its category is noted (`→ was: Electronics`) so you know where to apply the refund.
- **Per-item splits.** Multi-item charges can be turned into YNAB split transactions — one subtransaction per item at its price, plus a "Tax & shipping" remainder — so each item gets its own category. Splits are only proposed when the charge covers the whole order and every item price parsed; otherwise the transaction stays memo-only.

Everything runs client-side in the extension. Your data goes to exactly two places: amazon.com (your existing login session) and api.ynab.com (via OAuth). No backend, no analytics, no third parties.

## How it works

1. Fetches `amazon.com/cpe/yourpayments/transactions` in the background service worker using your existing Amazon login cookies, paginating via the page's widget-form POST. Each entry is an actual card charge or refund credit (one per shipment, so split shipments match correctly) with its order ID.
2. Fetches YNAB transactions over the same period (plus a 60-day lookback so refunds can find their original purchase) and matches each charge to an outflow — and each credit to an inflow — with the exact same amount, an Amazon-ish payee, an empty memo, and a date within -1 to +7 days. Digital orders are skipped.
3. For matched orders, fetches the order details page and parses item names and prices with cheerio (handles both the modern data-component page and the legacy print invoice). Unparseable pages are skipped rather than guessed at, and their raw HTML is exportable from the popup for debugging.
4. Scanning is a dry run: proposals show in the popup and nothing is written until you click Apply. Applied transaction IDs are remembered so re-scans don't re-apply.

## Install

**From a release (no build tools needed):** download the latest `-chrome.zip` from the [Releases page](https://github.com/jparavisini/amazon-exporter-for-ynab/releases), unzip it, open `chrome://extensions`, enable Developer mode, click "Load unpacked", and select the unzipped folder.

**From source:**

```bash
npm install
npm run build
```

Then load `.output/chrome-mv3` unpacked the same way.

A Chrome Web Store listing is in progress; once live, that becomes the recommended install.

## Setup

In the popup:

1. Click "Connect YNAB" and authorize the extension (OAuth; the short-lived access token is stored in the extension's local browser storage and sent only to api.ynab.com).
2. Pick your budget.
3. Click "Connect Amazon" to grant the host permission, and make sure you're signed in to amazon.com.
4. "Scan (dry run)", review the proposed memos and splits, then "Apply".

### OAuth client (maintainers and forks)

The extension authenticates with YNAB via the OAuth implicit grant, so it needs a registered OAuth application:

1. Register one at YNAB → Account Settings → Developer Settings → New OAuth Application, with redirect URI `https://obinghobhinimagmkihogflcieggmcgk.chromiumapp.org/`. That URI is stable because the extension ID is pinned by the `key` in `wxt.config.ts` — every unpacked install shares it.
2. Put the client ID in `YNAB_OAUTH_CLIENT_ID` in `lib/core/oauth.ts`. There is no client secret in the implicit flow, so the ID is safe to commit.

If you fork and change the manifest `key`, your extension ID — and therefore the redirect URI you must register — changes with it. New YNAB OAuth applications start in restricted mode (25 users); see the [YNAB API docs](https://api.ynab.com/) for the review process.

**Chrome Web Store builds:** `npm run zip:store` builds a zip without the manifest `key` — the store rejects manifests that contain one and assigns its own extension ID. After the first store upload, add that ID's redirect URI (`https://<store-extension-id>.chromiumapp.org/`) to the YNAB OAuth application alongside the unpacked one. Store listing copy and permission justifications live in [docs/store-listing.md](docs/store-listing.md).

**Releases:** pushing a `v*` tag builds the zip in CI and attaches it to a GitHub Release.

## Development

- `npm run dev` — WXT dev mode with reload
- `npm run smoke` — parser/matcher tests against synthetic fixtures
- `npm run typecheck` — TypeScript, strict mode
- `npx tsx scripts/parse-captures.ts <debug.json>` — run the invoice parser against real captured pages from the popup's debug export

The fragile piece is `parseInvoice` in `lib/core/amazon.ts`: Amazon's invoice markup varies and changes. If parsing breaks, export the debug data from the popup (it includes the raw HTML of unparseable pages) and adjust the selectors/regexes there; the smoke test fixtures in `scripts/smoke.ts` are the place to pin the behavior.

## Privacy

Fully client-side: no backend, no analytics, no third parties. See [PRIVACY.md](PRIVACY.md).

## Disclaimer

We are not affiliated, associated, or in any way officially connected with YNAB or any of its subsidiaries or affiliates. Nor with Amazon. The extension automates reading pages from your own Amazon account; Amazon's markup can change at any time and break parsing. Review proposals before applying — writes are limited to transaction memos and splits, but they are your budget's data.

## License

[MIT](LICENSE)
