import { describe, expect, it } from 'vitest';
import { buildMemoUpdateBody } from './ynab';

describe('buildMemoUpdateBody', () => {
  it('sends only the memo when splits are undefined', () => {
    expect(buildMemoUpdateBody('Item [111]', undefined)).toEqual({
      transaction: { memo: 'Item [111]' },
    });
  });

  it('sends only the memo when splits are an empty array', () => {
    expect(buildMemoUpdateBody('Item [111]', [])).toEqual({
      transaction: { memo: 'Item [111]' },
    });
  });

  it('sends the memo and subtransactions when splits are present', () => {
    const splits = [
      { amount: -10_000, memo: 'Item' },
      { amount: -1_000, memo: 'Tax & shipping' },
    ];
    expect(buildMemoUpdateBody('Item [111]', splits)).toEqual({
      transaction: { memo: 'Item [111]', subtransactions: splits },
    });
  });
});
