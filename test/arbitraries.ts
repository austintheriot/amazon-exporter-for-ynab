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

export const textArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 60 }),
  fc.string({ minLength: 200, maxLength: 600 }),
);

const itemArbWith = (
  price: fc.Arbitrary<number | null>,
): fc.Arbitrary<AmazonItem> => fc.record({ name: textArb, price });

const orderArbWith = (
  items: fc.Arbitrary<AmazonItem[]>,
): fc.Arbitrary<AmazonOrder> =>
  fc
    .record({
      id: orderIdArb,
      date: isoDateArb,
      items,
      extraCents: fc.integer({ min: 0, max: 2_000 }),
    })
    .map(({ id, date, items: orderItems, extraCents }) => {
      const itemCents = orderItems.reduce(
        (sum, item) => sum + Math.round((item.price ?? 0) * 100),
        0,
      );
      return {
        id,
        date,
        items: orderItems,
        total: (itemCents + extraCents) / 100,
      };
    });

export const orderArb: fc.Arbitrary<AmazonOrder> = orderArbWith(
  fc.array(itemArbWith(fc.option(dollarsArb, { nil: null })), {
    minLength: 1,
    maxLength: 6,
  }),
);

export const pricedOrderArb: fc.Arbitrary<AmazonOrder> = orderArbWith(
  fc.array(itemArbWith(dollarsArb), { minLength: 2, maxLength: 6 }),
);

export const refundAmountArb = (order: AmazonOrder): fc.Arbitrary<number> => {
  const prices = order.items.flatMap((item) =>
    item.price === null ? [] : [item.price],
  );
  return fc.oneof(
    fc.constant(order.total),
    ...(prices.length > 0 ? [fc.constantFrom(...prices)] : []),
    dollarsArb,
  );
};
