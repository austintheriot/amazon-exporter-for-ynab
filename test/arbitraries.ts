import fc from 'fast-check';
import type { AmazonCharge, AmazonItem, AmazonOrder } from '../lib/core/amazon';
import type { YnabTransaction } from '../lib/core/ynab';

const FIRST_DAY_MS = Date.UTC(2020, 0, 1);
const DAY_MS = 86_400_000;
const DAY_COUNT = 11 * 365 + 3;

export const orderIdArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(
      fc.stringMatching(/^D\d{2}$/),
      fc.stringMatching(/^\d{3}$/),
    ),
    fc.stringMatching(/^\d{7}$/),
    fc.stringMatching(/^\d{7}$/),
  )
  .map(([prefix, middle, suffix]) => `${prefix}-${middle}-${suffix}`);

export const isoDateArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: DAY_COUNT - 1 })
  .map((offset) =>
    new Date(FIRST_DAY_MS + offset * DAY_MS).toISOString().slice(0, 10),
  );

export const dollarsArb: fc.Arbitrary<number> = fc
  .integer({ min: 1, max: 999_999 })
  .map((cents) => cents / 100);

export const chargeArb: fc.Arbitrary<AmazonCharge> = fc.record({
  orderId: orderIdArb,
  date: isoDateArb,
  amount: dollarsArb,
  paymentMethod: fc.constant('Visa ****1234'),
});

const amazonPayeeArb = fc.constantFrom(
  'Amazon',
  'AMAZON.COM',
  'Amazon Marketplace',
  'AMZN Mktp US',
  'amzn.com/bill',
);

const blankMemoArb = fc.constantFrom<string | null | undefined>(
  null,
  undefined,
  '',
  '   ',
);

export const transactionArb: fc.Arbitrary<YnabTransaction> = fc.record({
  id: fc.uuid(),
  date: isoDateArb,
  amount: fc
    .tuple(dollarsArb, fc.constantFrom(-1, 1))
    .map(([dollars, sign]) => sign * Math.round(dollars * 1000)),
  payee_name: amazonPayeeArb,
  memo: blankMemoArb,
  category_name: fc.constant(null),
});

const itemArb: fc.Arbitrary<AmazonItem> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 300 }),
  price: fc.option(dollarsArb, { nil: null }),
});

export const orderArb: fc.Arbitrary<AmazonOrder> = fc
  .record({
    id: orderIdArb,
    date: isoDateArb,
    items: fc.array(itemArb, { minLength: 1, maxLength: 6 }),
    extraCents: fc.integer({ min: 0, max: 2_000 }),
  })
  .map(({ id, date, items, extraCents }) => {
    const itemCents = items.reduce(
      (sum, item) => sum + Math.round((item.price ?? 0) * 100),
      0,
    );
    return { id, date, items, total: (itemCents + extraCents) / 100 };
  });
