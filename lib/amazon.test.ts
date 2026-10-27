import { load } from 'cheerio/slim';
import { describe, expect, it } from 'vitest';
import {
  buildNextPageBody,
  parseInvoice,
  parseTransactionsPage,
} from './amazon';
import {
  lastPageHtml,
  legacyInvoiceHtml,
  modernInvoiceHtml,
  nextDataHtml,
  nextDataThousandsHtml,
  thousandsInvoiceHtml,
  thousandsMarkupHtml,
  transactionsHtml,
  unparseableInvoiceHtml,
} from '../test/fixtures/amazon';

describe('parseTransactionsPage (markup)', () => {
  const $txn = load(transactionsHtml);
  const page = parseTransactionsPage($txn);

  it('two charges parsed', () => {
    expect(page.charges.length).toBe(2);
  });
  it('one credit parsed', () => {
    expect(page.credits.length).toBe(1);
  });
  it('credit fields', () => {
    expect(page.credits[0]).toMatchObject({
      orderId: '113-3333333-3333333',
      date: '2026-06-25',
      amount: 12.5,
    });
  });
  it('charge fields', () => {
    expect(page.charges[0]).toMatchObject({
      orderId: '113-1111111-1111111',
      date: '2026-06-28',
      amount: 70.32,
    });
  });
  it('payment method', () => {
    expect(page.charges[0]?.paymentMethod.includes('1234')).toBe(true);
  });
  it('date groups apply in order', () => {
    expect(page.charges[1]?.date).toBe('2026-06-28');
  });
});

describe('buildNextPageBody', () => {
  it('next page body built', () => {
    expect(buildNextPageBody(load(transactionsHtml))).not.toBeNull();
  });
  it('next page body has widget state and event', () => {
    const body = buildNextPageBody(load(transactionsHtml)) ?? '';
    expect(body).toContain('ppw-widgetState=STATE_TOKEN_123');
    expect(body).toContain('DefaultNextPageNavigationEvent');
  });
  it('no next page on last page', () => {
    expect(buildNextPageBody(load(lastPageHtml))).toBeNull();
  });
});

describe('parseInvoice (legacy print page)', () => {
  const order = parseInvoice(legacyInvoiceHtml, '112-1234567-7654321');

  it('legacy invoice parses', () => {
    expect(order).not.toBeNull();
  });
  it('legacy date', () => {
    expect(order?.date).toBe('2026-06-12');
  });
  it('legacy total', () => {
    expect(order?.total).toBe(67.39);
  });
  it('legacy items', () => {
    expect(order?.items.length).toBe(2);
  });
  it('legacy item prices', () => {
    expect(order?.items[0]?.price).toBe(49.99);
    expect(order?.items[1]?.price).toBe(12.99);
  });
});

describe('parseInvoice (modern data-component page)', () => {
  const modern = parseInvoice(modernInvoiceHtml, '113-5256529-7477024');

  it('modern invoice parses', () => {
    expect(modern).not.toBeNull();
  });
  it('modern date', () => {
    expect(modern?.date).toBe('2026-06-28');
  });
  it('modern total', () => {
    expect(modern?.total).toBe(28.98);
  });
  it('modern item', () => {
    expect(modern?.items[0]?.name).toBe(
      '15 Pack 5 Gallon Mylar Bags with Oxygen Absorbers',
    );
  });
  it('unparseable invoice returns null', () => {
    expect(parseInvoice(unparseableInvoiceHtml, 'x')).toBeNull();
  });
});

describe('parseTransactionsPage (__NEXT_DATA__)', () => {
  const page = parseTransactionsPage(load(nextDataHtml));

  it('reads one charge', () => {
    expect(page.charges).toEqual([
      {
        orderId: '113-1111111-1111111',
        date: '2026-06-28',
        amount: 70.32,
        paymentMethod: 'Prime Visa ****1234',
      },
    ]);
  });
  it('reads one credit from a Refund status', () => {
    expect(page.credits).toEqual([
      {
        orderId: '113-3333333-3333333',
        date: '2026-06-25',
        amount: 12.5,
        paymentMethod: 'Prime Visa ****1234',
      },
    ]);
  });
  it('skips the row without a date', () => {
    const orderIds = [...page.charges, ...page.credits].map(
      (charge) => charge.orderId,
    );
    expect(orderIds).not.toContain('113-4444444-4444444');
  });
  it('returns empty lists when the page has no __NEXT_DATA__ script', () => {
    expect(parseTransactionsPage(load(lastPageHtml))).toEqual({
      charges: [],
      credits: [],
    });
  });
});

describe('thousands separators', () => {
  it('parses thousands separators on both page layouts and invoices', () => {
    const markupCharge = parseTransactionsPage(load(thousandsMarkupHtml))
      .charges[0];
    const jsonCharge = parseTransactionsPage(load(nextDataThousandsHtml))
      .charges[0];
    const order = parseInvoice(thousandsInvoiceHtml, '112-1234567-7654321');
    expect(markupCharge?.amount).toBe(1234.56);
    expect(jsonCharge?.amount).toBe(1234.56);
    expect(order?.total).toBe(1234.56);
  });
});
