/* Run parseInvoice against real captured pages:
 *   bun scripts/parse-captures.ts ~/Downloads/ynab-amazon-debug.json */
import { readFileSync } from 'node:fs';
import { parseInvoice } from '../lib/core/amazon';
import { parseCaptureFile } from './captures';

const file = process.argv[2];
if (!file) {
  console.error('usage: bun scripts/parse-captures.ts <debug.json>');
  process.exit(1);
}

const parsed = parseCaptureFile(JSON.parse(readFileSync(file, 'utf8')));
if (!parsed.success) {
  console.error(`invalid capture file ${file}:\n${parsed.message}`);
  process.exit(1);
}

let failures = 0;
for (const capture of parsed.captures) {
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
