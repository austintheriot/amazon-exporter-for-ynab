/* Run parseInvoice against real captured pages:
 *   bun scripts/parse-captures.ts ~/Downloads/ynab-amazon-debug.json */
import { readFileSync } from 'node:fs';
import { z } from 'zod/mini';
import { invoiceCapturesSchema, parseInvoice } from '../lib/core/amazon';

const file = process.argv[2];
if (!file) {
  console.error('usage: bun scripts/parse-captures.ts <debug.json>');
  process.exit(1);
}

const parsed = invoiceCapturesSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')), {
  error: z.locales.en().localeError,
});
if (!parsed.success) {
  console.error(`invalid capture file ${file}:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

let failures = 0;
for (const capture of parsed.data) {
  const order = parseInvoice(capture.html, capture.orderId);
  if (order) {
    console.log(
      `ok   ${capture.orderId}: ${order.date} $${String(order.total)} — ${order.items
        .map((item) => `${item.name.slice(0, 50)}${item.price !== null ? ` ($${String(item.price)})` : ''}`)
        .join(' | ')}`,
    );
  } else {
    failures++;
    console.error(`FAIL ${capture.orderId}: parseInvoice returned null`);
  }
}
process.exit(failures ? 1 : 0);
