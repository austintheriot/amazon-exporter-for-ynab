# Chrome Web Store listing

Copy for the store listing and the review questionnaire. Keep in sync with README.md and PRIVACY.md.

## Basics

- **Name:** Amazon Exporter for YNAB
- **Category:** Productivity → Tools
- **Summary (132 chars max):** Match Amazon order history to YNAB transactions: item-name memos, refund attribution, and per-item splits.

## Description

Amazon transactions land in YNAB as an amount and the payee "Amazon" — nothing else. This extension fills the gap.

Connect your YNAB account, scan your Amazon order history, review the proposals, and apply:

- Item-name memos: each matched charge gets a memo listing the order's items, with the Amazon order ID appended for easy lookup.
- Refund attribution: refund credits are matched to YNAB inflows and annotated with the returned items and the original purchase's category.
- Per-item splits: multi-item charges can become YNAB split transactions, one subtransaction per item, so each item gets its own category.

Everything runs client-side in the extension. Your data goes to exactly two places: amazon.com (your existing login session) and api.ynab.com (via OAuth). No backend, no analytics, no third parties. Scanning is a dry run; nothing is written to your budget until you click Apply, and writes are limited to transaction memos and splits.

Not affiliated with YNAB or Amazon.

## Permission justifications

- **storage** — caches the YNAB OAuth token, the selected budget, and applied-transaction IDs locally so re-scans don't re-apply.
- **identity** — runs the YNAB OAuth flow via `chrome.identity.launchWebAuthFlow`; the token is stored locally and sent only to api.ynab.com.
- **host: api.ynab.com** — reads the user's YNAB transactions and writes the memos/splits the user approves.
- **optional host: amazon.com** — requested at runtime when the user clicks "Connect Amazon"; reads the user's own order history and invoices to match against YNAB transactions. Nothing is written to Amazon.

## Data-use disclosures

- Collects: financial and payment information (transaction data) — processed locally, sent only to the user's own YNAB account via api.ynab.com.
- No data sold, no data transferred to third parties, no use unrelated to the extension's single purpose, no use for creditworthiness or lending.
- Privacy policy URL: https://github.com/jparavisini/amazon-exporter-for-ynab/blob/main/PRIVACY.md

## Single purpose

Enrich the user's YNAB transactions with details from the user's own Amazon order history.

## Publishing checklist

1. `bun run zip:store` (builds without the manifest `key`; the store assigns its own extension ID).
2. Upload the zip at https://chrome.google.com/webstore/devconsole, fill this listing, submit for review.
3. Note the store-assigned extension ID and add `https://<store-extension-id>.chromiumapp.org/` as a second redirect URI on the YNAB OAuth application (app.ynab.com → Account Settings → Developer Settings).
4. Request YNAB app review to lift the 25-user restricted mode before promoting the listing.

## Status (2026-07-18)

- v0.1.0 submitted for review. Store extension ID: `gnphifadcnipkgcbfohpcmajahpliilf`.
- Both redirect URIs (unpacked `obingho…` and store `gnphif…`) are registered on the YNAB OAuth application.
- Store icon is `public/icon/128.png`; screenshot was the popup padded to 1280×800.
- Outstanding: YNAB app review to lift the 25-user restricted mode (step 4).
