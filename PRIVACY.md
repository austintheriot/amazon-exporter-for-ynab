# Privacy policy

**Last updated: July 18, 2026**

Amazon Exporter for YNAB is a browser extension that runs entirely on your device. There is no backend server, no analytics, and no third-party service of any kind.

## What data the extension accesses

- **Amazon order data.** With your permission, the extension reads pages from amazon.com using your existing browser login: the card transactions page (charge and refund amounts, dates, order IDs, payment method last-4) and order detail pages (item names and prices). This data never leaves your browser except as described below.
- **YNAB budget data.** Via OAuth, the extension reads your budget list and transactions from api.ynab.com, and — only when you click Apply — writes transaction memos and splits back to api.ynab.com.

## What data the extension stores

All storage is the extension's local browser storage on your device:

- Your YNAB OAuth access token (short-lived; expires after about two hours)
- Your selected budget ID and scan settings
- The results of the latest scan, including proposed memos and, for debugging, the raw HTML of Amazon pages that failed to parse

Nothing is stored anywhere else.

## Where data is sent

Data is sent to exactly two places, both at your direction: amazon.com (reads, using your existing session) and api.ynab.com (reads, plus memo/split writes you approve). No data is sent to the extension's author or to any third party, and none is sold.

## Data retention and deletion

Data persists only in your browser's local extension storage. To delete it: click "Disconnect YNAB" in the popup (removes the token), and remove the extension from your browser (removes everything). You can also revoke the extension's access at any time from YNAB → Account Settings → Authorized Applications, and manage Amazon page access from the extension's site-permissions settings.

## Changes

Changes to this policy are published in this file with an updated date; the version history is visible in the repository's git log.

## Contact

Open an issue at [github.com/jparavisini/amazon-exporter-for-ynab](https://github.com/jparavisini/amazon-exporter-for-ynab/issues).
