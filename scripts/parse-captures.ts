/* Run parseInvoice against real captured pages:
 *   bun scripts/parse-captures.ts ~/Downloads/ynab-amazon-debug.json */
import { readFileSync } from 'node:fs';
import { parseInvoice } from '../lib/core/amazon';

const file = process.argv[2];
if (!file) {
  console.error('usage: bun scripts/parse-captures.ts <debug.json>');
  process.exit(1);
}

const captures = JSON.parse(readFileSync(file, 'utf8')) as {
  orderId: string;
  html: string;
}[];

let failures = 0;
for (const c of captures) {
  const order = parseInvoice(c.html, c.orderId);
  if (order) {
    console.log(
      `ok   ${c.orderId}: ${order.date} $${String(order.total)} — ${order.items
        .map((item) => `${item.name.slice(0, 50)}${item.price !== null ? ` ($${String(item.price)})` : ''}`)
        .join(' | ')}`,
    );
  } else {
    failures++;
    console.error(`FAIL ${c.orderId}: parseInvoice returned null`);
  }
}
process.exit(failures ? 1 : 0);
